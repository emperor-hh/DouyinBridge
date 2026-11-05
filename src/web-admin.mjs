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
export async function startAdmin({gateway,store,automation=null,host='127.0.0.1',port=3219,token,uiFile=new URL('../web/index.html',import.meta.url)}){
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
      if(automation&&req.method==='GET'&&url.pathname==='/api/automation'){
        const state=automation.state();
        return json(res,200,{...state,candidates:Object.fromEntries(
          state.plans.map(plan=>[plan.id,automation.store.candidates(plan.id)]))});
      }
      if(automation&&req.method==='POST'&&url.pathname==='/api/automation/plans'){
        const input=await readJson(req);
        const plan=automation.store.createPlan(input);
        return json(res,201,{plan});
      }
      if(automation&&url.pathname.startsWith('/api/automation/plans/')){
        const match=/^\/api\/automation\/plans\/([0-9a-f-]{36})(?:\/(browse|candidates))?$/.exec(url.pathname);
        if(!match)return json(res,404,{error:'invalid plan path'});
        const [,id,op]=match;
        if(req.method==='PUT'&&!op){
          const body=await readJson(req);
          if(typeof body?.enabled!=='boolean'||Object.keys(body).length!==1)
            return json(res,400,{error:'expected {enabled: boolean}'});
          const plan=automation.store.setEnabled(id,body.enabled);
          if(!body.enabled)automation.cancelPlan(id);
          return json(res,200,{plan});
        }
        if(req.method==='POST'&&op==='candidates'){
          const body=await readJson(req);
          if(!body||typeof body.url!=='string'||
            Object.keys(body).some(x=>!['url','title','author'].includes(x)))
            return json(res,400,{error:'invalid candidate input'});
          const result=automation.store.addCandidates(id,[body],{source:'manual'});
          return json(res,200,{...result,candidates:automation.store.candidates(id)});
        }
        if(req.method==='POST'&&op==='browse'){
          const result=await automation.browseNow(id);
          return json(res,200,{...result,candidates:automation.store.candidates(id)});
        }
        return json(res,404,{error:'route not found'});
      }
      if(automation&&url.pathname.startsWith('/api/automation/deliveries/')){
        const id=/^\/api\/automation\/deliveries\/([0-9a-f-]{36})$/.exec(url.pathname)?.[1];
        if(!id||req.method!=='PUT')return json(res,404,{error:'route not found'});
        const body=await readJson(req);
        if(!['confirmed','not-sent'].includes(body?.outcome)||Object.keys(body).length!==1)
          return json(res,400,{error:'invalid review outcome'});
        return json(res,200,{delivery:automation.store.resolveDelivery(id,body.outcome)});
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
        const isCover=url.pathname.endsWith('/cover');
        const isVideo=url.pathname.endsWith('/video');
        const isSticker=url.pathname.endsWith('/sticker');
        const isAutoShare=url.pathname.endsWith('/auto-share');
        const suffix=isAutoShare?'/auto-share':isSticker?'/sticker':isVideo?'/video':isCover?'/cover':'';
        const id=decodeURIComponent(url.pathname.slice('/api/conversations/'.length,suffix? -suffix.length:undefined));
        const body=await readJson(req);
        if(!body||typeof body.enabled!=='boolean'||Object.keys(body).some(x=>x!=='enabled'))
          return json(res,400,{error:'expected {enabled: boolean}'});
        const updated=isAutoShare?store.setAutoShareEnabled(id,body.enabled):isSticker?store.setStickerEnabled(id,body.enabled):isVideo?store.setVideoEnabled(id,body.enabled):
          isCover?store.setCoverEnabled(id,body.enabled):store.setEnabled(id,body.enabled);
        if(!isCover)gateway.authorizationChanged(id);
        if(!body.enabled&&(isAutoShare||!suffix)&&automation)
          for(const plan of automation.store.plans().filter(p=>p.conversationId===id))
            automation.cancelPlan(plan.id);
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
