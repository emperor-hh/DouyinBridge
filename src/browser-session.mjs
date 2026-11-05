import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOME = 'https://www.douyin.com/';
const CHAT_LABEL = 'deepseek-douyin-api-chat';

export async function createBrowserSession({ profileDir, upstreamDir, headless = true, browserChannel = 'chromium', chromiumImpl } = {}) {
  if (!profileDir || !path.isAbsolute(profileDir)) throw Error('profileDir must be absolute');
  if (!upstreamDir || !path.isAbsolute(upstreamDir)) throw Error('upstreamDir must be absolute');
  fs.mkdirSync(profileDir, { recursive: true });
  const chromium = chromiumImpl ??
    (await import(pathToFileURL(path.join(upstreamDir, 'playwright-runtime.mjs')).href)).chromium;
  const options = {headless,viewport:{width:1366,height:900},locale:'zh-CN',acceptDownloads:false};
  if(browserChannel !== 'bundled')options.channel=browserChannel;
  const context = await chromium.launchPersistentContext(profileDir, options);
  let closed=false;
  try {
    // Video playback is not part of a text-message gateway. Do not override
    // browser detection signals or the user's verification flow.
    // New Douyin chat cards use BulletBulletVideo classes. Supply only DOM
    // aliases; upstream still verifies the message-bound work ID and links.
    await context.addInitScript(() => {
      const aliases=[
        ['BulletBulletVideocontainer','MessageItemShareAwemecontainer'],
        ['BulletBulletVideoauthorName','MessageItemShareAwemeauthorName'],
        ['BulletBulletVideoawemeContainer','MessageItemShareAwemeawemeContainer'],
        ['BulletBulletVideoauthorAvatar','MessageItemShareAwemeauthorAvatar']
      ];
      const normalize=root=>{
        if(!root.querySelectorAll)return;
        for(const [source,target] of aliases){
          const nodes=[...(root.matches?.('.'+source)?[root]:[]),...root.querySelectorAll('.'+source)];
          for(const node of nodes)node.classList.add(target);
        }
      };
      normalize(document);
      new MutationObserver(records=>{
        for(const record of records)for(const node of record.addedNodes)normalize(node);
      }).observe(document,{childList:true,subtree:true});
    });
    await context.addInitScript(() => {
      document.addEventListener('play',event=>{
        if(event.target instanceof HTMLVideoElement) {
          try{
            if(window.__douyinbridgeSamplingAuthorized===true){
              event.target.muted=true;event.target.volume=0;
            }else HTMLMediaElement.prototype.pause.call(event.target);
          }catch{}
        }
      },true);
    });
  }catch(e){await context.close().catch(()=>{});throw e;}
  const close=async()=>{if(closed)return;closed=true;await context.close();};
  const browser={isConnected:()=>!closed,contexts:()=>[context],close};
  return {
    context,browser,close,
    async openLoginPage(){
      const page=context.pages().find(p=>!p.isClosed())??await context.newPage();
      await page.goto(HOME,{waitUntil:'domcontentloaded'});
      return page;
    },
    async prepareChatPage(){
      const existing=context.pages().filter(p=>!p.isClosed());
      const page=existing.find(p=>p.url().startsWith(HOME))??existing[0]??await context.newPage();
      if(page.url()==='about:blank'){
        await page.evaluate(name=>{window.name=name;},CHAT_LABEL);
        await page.goto(HOME,{waitUntil:'domcontentloaded'});
      }
      await page.evaluate(name=>{window.name=name;},CHAT_LABEL);
      return page;
    }
  };
}
