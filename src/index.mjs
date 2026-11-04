import fs from 'node:fs';
import path from 'node:path';
import { configFromEnv } from './config.mjs';
import { IdentityStore } from './identity.mjs';
import { AllowlistStore } from './allowlist-store.mjs';
import { startAdmin } from './web-admin.mjs';
import { loadDriver } from './douyin-driver.mjs';
import { createBrowserSession } from './browser-session.mjs';
import { summarizeContactListing, formatContactListing } from './contact-list.mjs';
import { OneBotClient } from './onebot.mjs';
import { Gateway } from './gateway.mjs';

const cfg=configFromEnv(),args=new Set(process.argv.slice(2));
const login=args.has('--login'),listContacts=args.has('--list-contacts');
if(login&&listContacts)throw Error('--login and --list-contacts cannot be combined');
const visible=args.has('--visible')||login||cfg.browserMode==='visible';
fs.mkdirSync(cfg.data,{recursive:true});
process.env.DOUYIN_STATE_DIR=path.join(cfg.data,'upstream-state');
process.env.DOUYIN_RUNTIME_LOCATION_FILE=path.join(cfg.data,'runtime-location.json');
fs.mkdirSync(path.join(cfg.profileDir,'control'),{recursive:true});
const browserArgs={upstreamDir:cfg.upstream,profileDir:cfg.profileDir,headless:!visible,browserChannel:cfg.browserChannel};
let session,driver,client,gateway,allowlist,admin,stopping=false;
async function stop(){
  if(stopping)return;stopping=true;
  if(gateway){gateway.running=false;for(const abort of gateway.videoAbort.values())abort.abort(Error('stopping'));}
  client?.close();
  if(admin)await admin.close().catch(e=>console.error('[admin close]',e.message));
  const closing=driver?.close?.()??session?.close?.();
  if(closing)await closing.catch(e=>console.error('[browser close]',e.message));
  allowlist?.close();
}
process.on('SIGINT',()=>{void stop();});
process.on('SIGTERM',()=>{void stop();});
try{
  if(login){
    session=await createBrowserSession(browserArgs);
    const page=await session.openLoginPage();
    console.log('[login] 请在浏览器手动登录：',page.url());
    console.log('[login] 登录完成后按 Ctrl+C 退出。资料目录：',cfg.profileDir);
    while(!stopping&&session.context.pages().some(p=>!p.isClosed()))
      await new Promise(resolve=>setTimeout(resolve,500));
  }else if(listContacts){
    driver=await loadDriver(browserArgs);
    const result=await driver.listContacts({verifyFollowing:false,backgroundOnly:false});
    console.log(formatContactListing(summarizeContactListing(result)));
  }else{
    driver=await loadDriver(browserArgs);
    allowlist=new AllowlistStore(path.join(cfg.data,'allowlist.sqlite'),{legacyAllowlist:cfg.allowlist});
    const store=new IdentityStore(path.join(cfg.data,'identities.json'));
    client=new OneBotClient({url:cfg.url,token:cfg.token,selfId:990000001,
      actions:(a,p)=>gateway.actions(a,p),onState:s=>console.log('[onebot]',s)});
    gateway=new Gateway({driver,store,client,config:cfg,allowlist});
    admin=await startAdmin({gateway,store:allowlist,port:cfg.adminPort,token:cfg.adminToken});
    console.log('[admin] URL:',admin.url);
    console.log('[admin] Token:',admin.token);
    console.log('[browser]',visible?'visible':'headless',cfg.browserChannel,'profile:',cfg.profileDir);
    console.log('[gateway] Sending enabled:',cfg.enableSending,'authorized:',allowlist.list().filter(c=>c.enabled).length);
    client.connect();await gateway.loop();
  }
}finally{await stop();}
