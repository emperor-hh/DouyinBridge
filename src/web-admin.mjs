import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const json=(res,code,value)=>{
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(value));
};
function constantTimeToken(received,expected){
  const a=Buffer.from(received??''); const b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
async function readJson(req){
  let count=0;const chunks=[];
  for await(const chunk of req){
    count+=chunk.length;
    if(count>4096)throw Object.assign(Error('request too large'),{statusCode:413});
    chunks.push(chunk);
  }
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch {throw Object.assign(Error('invalid JSON'),{statusCode:400});}
}
export async function startAdmin({gateway,store,host='127.0.0.1',port=3219,token,uiFile=new URL('../web/index.html',import.meta.url)}){
  if(host!=='127.0.0.1'&&host!=='::1')throw Error('admin UI must bind to loopback');
  const secret=token?.trim()||randomBytes(24).toString('hex');
  if(secret.length<20)throw Error('ADMIN_TOKEN must contain at least 20 characters');
  const html=await readFile(uiFile,'utf8');
  const server=http.createServer(async(req,res)=>{
    try{
      const origin=`http://${host.includes(':')?`[${host}]`:host}:${server.address()?.port??port}`;
      const url=new URL(req.url??'/',origin);
      if(url.origin!==origin) return json(res,400,{error:'invalid host'});
      const isApi=url.pathname.startsWith('/api/');
      if(isApi){
        if(req.headers.origin && req.headers.origin!==origin)return json(res,403,{error:'cross-origin forbidden'});
        const header=String(req.headers.authorization??'');
        if(!header.startsWith('Bearer ')||!constantTimeToken(header.slice(7),secret))
          return json(res,401,{error:'invalid admin token'});
      }
      if(req.method==='GET'&&url.pathname==='/'){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
          'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"});
        return res.end(html);
      }
      if(req.method==='GET'&&url.pathname==='/app.js'){
        const js=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
        res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        return res.end(js);
      }
      if(req.method==='GET'&&url.pathname==='/api/status'){
        return json(res,200,{running:gateway.running,discovered:store.list().length,
          authorized:store.list().filter(x=>x.enabled).length,lastScan:gateway.lastScan??null,
          scanError:gateway.lastScanError??null,busy:gateway.isScanning()});
      }
      if(req.method==='GET'&&url.pathname==='/api/conversations')return json(res,200,{items:store.list()});
      if(req.method==='POST'&&url.pathname==='/api/refresh'){
        const result=await gateway.refresh({force:true});
        return json(res,200,{count:result.count,scannedToEnd:result.scannedToEnd,notes:result.notes??null,items:store.list()});
      }
      if(req.method==='PUT'&&url.pathname.startsWith('/api/conversations/')){
        const id=decodeURIComponent(url.pathname.slice('/api/conversations/'.length));
        const body=await readJson(req);
        if(!body||typeof body.enabled!=='boolean'||Object.keys(body).some(x=>x!=='enabled'))
          return json(res,400,{error:'expected {enabled: boolean}'});
        const updated=store.setEnabled(id,body.enabled);
        gateway.authorizationChanged(id);
        return json(res,200,{item:updated});
      }
      return json(res,404,{error:'not found'});
    }catch(e){return json(res,e.statusCode??500,{error:e.statusCode?e.message:'request failed; see server logs'});
      }
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,host,()=>{server.off('error',reject);resolve();});
  });
  return {server,token:secret,url:`http://${host.includes(':')?`[${host}]`:host}:${server.address().port}/`,
    close:()=>new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()))};
}
