import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {pathToFileURL} from 'node:url';

const HOME='https://www.douyin.com/?recommend=1&from_nav=1';
const LABEL='deepseek-douyin-api';
const VIDEO_ID=/^\d{1,64}$/;
const wait=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(signal.reason);
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);
  const stop=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(signal.reason);};
  signal?.addEventListener('abort',stop,{once:true});
});
const checkState=state=>{
  if(state?.loginRequired||state?.verificationRequired||state?.unsupportedPage||state?.privateChatVisible)
    throw Error('抖音自动浏览遇到登录、验证或非视频页面，需要人工处理');
};
function candidate(state){
  checkState(state);
  const v=state?.video;
  if(state?.videoSelection?.ambiguous||state?.videoSelection?.identityConflict||
    !VIDEO_ID.test(v?.id??'')||v?.url!==`https://www.douyin.com/video/${v.id}`||
    !Number.isFinite(v.readyState)||v.readyState<2)return null;
  return {videoId:v.id,url:v.url,title:String(v.title??'').trim().slice(0,220),
    author:String(v.author??'').trim().slice(0,120)};
}
// Upstream controller needs a limit object even for a bounded, explicitly
// requested DouyinLuma job. This is NOT a bypass of DouyinLuma's own quotas:
// the scheduler enforces independent, persistent daily limits and permissions.
function scopedVideoLimits(stateDir,authorized){
  return {
    stateDir,
    beforeAction:()=>({allowed:authorized(),reason:authorized()?'':'automated job not authorized'}),
    state:()=>({allowed:authorized(),session:{status:authorized()?'active':'ended'}}),
    watch:()=>()=>{},notePlayback:()=>{},settleWatching:()=>{}
  };
}
export async function createAutomationBrowser({session,upstreamDir,dataDir,chat}){
  const imported=await Promise.all(['core.mjs','video-forward.mjs','contact-authorization.mjs']
    .map(name=>import(pathToFileURL(path.join(upstreamDir,name)).href)));
  const [{BrowserController,readPageState},{VideoForwarder},{hasStableConversationIdentity}]=imported;
  const stateDir=path.join(dataDir,'automation-upstream');
  const controlDir=path.join(dataDir,'automation-control');
  fs.mkdirSync(stateDir,{recursive:true});fs.mkdirSync(controlDir,{recursive:true});
  let active=false,closed=false,videoPage=null;
  const limits=scopedVideoLimits(stateDir,()=>active&&!closed);
  const controller=new BrowserController({source:'api',videoLimits:limits,controlDirectory:controlDir});
  // Upstream BrowserController.withPage closes its browser on abort.
  // Never let an automation cancellation close the shared Douyin chat context.
  controller.browser={
    isConnected:()=>session.browser.isConnected(),
    contexts:()=>session.browser.contexts(),
    close:async()=>{
      if(videoPage&&!videoPage.isClosed())await videoPage.close().catch(()=>{});
    }
  };
  const forwarder=new VideoForwarder({controller,chatBrowser:chat,videoLimits:limits,
    stateDir,source:'api'});
  async function pageForVideo(){
    if(closed)throw Error('automation browser closed');
    if(!videoPage||videoPage.isClosed()){
      videoPage=await session.context.newPage();
      await videoPage.evaluate(label=>{window.name=label;},LABEL);
    }
    controller.page=videoPage;
    return videoPage;
  }
  async function setMutedPlaying(page,allow){
    await page.evaluate(value=>{
      window.__douyinlumaSamplingAuthorized=value;
      for(const v of document.querySelectorAll('video')){
        try{v.muted=true;v.volume=0;if(!value)v.pause();}catch{}
      }
    },allow);
  }
  async function observation(page,{signal,seconds=1}={}){
    signal?.throwIfAborted();
    const first=await page.evaluate(readPageState);checkState(first);
    const work=candidate(first);
    if(!work)return null;
    await setMutedPlaying(page,true);
    const playing=await page.evaluate(async()=>{
      const elements=[...document.querySelectorAll('video')].filter(v=>{
        const r=v.getBoundingClientRect();
        return r.width>10&&r.height>10&&r.top<innerHeight&&r.bottom>0;
      });
      if(elements.length!==1)return false;
      const v=elements[0];
      try{v.muted=true;v.volume=0;await v.play();return !v.paused;}catch{return false;}
    });
    if(!playing)return null;
    await wait(seconds*1000,signal);
    const final=await page.evaluate(readPageState);
    checkState(final);
    if(!candidate(final)||final.video.id!==work.videoId||final.video.paused||
      !Number.isFinite(final.video.time)||!Number.isFinite(first.video.time)||
      final.video.time<=first.video.time+0.1)return null;
    return work;
  }
  return {
    async browse({topic='',maxVideos=5,signal}={}){
      if(active)throw Error('automated browser busy');
      active=true;
      try{
        signal?.throwIfAborted();
        if(!Number.isInteger(maxVideos)||maxVideos<1||maxVideos>10)throw Error('invalid browse count');
        const page=await pageForVideo(),items=[],seen=new Set();
        const remember=item=>{if(item&&!seen.has(item.videoId)){seen.add(item.videoId);items.push(item);}};
        if(topic){
          const value=String(topic).trim().slice(0,80);
          await page.goto('https://www.douyin.com/search/'+encodeURIComponent(value),
            {waitUntil:'domcontentloaded',timeout:20000});
          const search=await page.evaluate(readPageState);checkState(search);
          const links=(search.searchResults??[]).filter(v=>VIDEO_ID.test(v.id??'')&&
            v.url===`https://www.douyin.com/video/${v.id}`).slice(0,maxVideos*2);
          for(const item of links){
            if(items.length>=maxVideos)break;
            signal?.throwIfAborted();
            await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:20000});
            await setMutedPlaying(page,true);
            try{remember(await observation(page,{signal,seconds:1}));}finally{await setMutedPlaying(page,false);}
          }
        }else{
          await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:20000});
          await setMutedPlaying(page,true);
          for(let i=0;i<maxVideos;i++){
            signal?.throwIfAborted();
            let state=await page.evaluate(readPageState);checkState(state);
            const work=candidate(state);
            try{remember(await observation(page,{signal,seconds:1}));}
            finally{await setMutedPlaying(page,false);}
            if(i===maxVideos-1)break;
            // Use upstream's verified next-video switching, not blind wheel spam.
            if(!work)break;
            await setMutedPlaying(page,true);
            const changed=await controller.switchVideo(1,signal,{
              recordLearning:false,expectedVideoId:work.videoId});
            if(changed?.changed!==true)break;
          }
        }
        return items;
      }finally{
        active=false;
        if(videoPage&&!videoPage.isClosed()){
          await setMutedPlaying(videoPage,false).catch(()=>{});
        }
      }
    },
    async shareNative({contact,videoId,url,authorized,signal}){
      if(active)throw Error('automated browser busy');
      if(!contact||!hasStableConversationIdentity(contact)||
        videoId!==/\/video\/(\d{1,64})$/.exec(url??'')?.[1]||
        url!==`https://www.douyin.com/video/${videoId}`)
        throw Error('sharing contact or work identity not verified');
      if(typeof authorized!=='function'||!authorized())throw Error('scheduled share not authorized');
      active=true;
      const policy=path.join(stateDir,'chat-policy.json');
      const stored={...contact,name:contact.name??contact.displayName,
        authorizationKind:'manual',verifiedAt:new Date().toISOString()};
      try{
        // The upstream autonomous forwarding API intentionally does not accept
        // an arbitrary URL. Select the saved candidate by navigating our own
        // dedicated video tab, then validate its real player identity.
        const page=await pageForVideo();
        await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
        await page.evaluate(label=>{window.name=label;},LABEL);
        let selected=false;
        for(let i=0;i<30;i++){
          signal?.throwIfAborted();
          const state=await page.evaluate(readPageState);
          checkState(state);
          if(candidate(state)?.videoId===videoId){selected=true;break;}
          await wait(400,signal);
        }
        if(!selected)throw Error('当前页面没有核实到计划中的作品，未进入原生分享');
        const tmp=policy+'.'+randomUUID()+'.tmp';
        try{
          fs.writeFileSync(tmp,JSON.stringify({allowlist:[stored]}),{flag:'wx',mode:0o600});
          fs.renameSync(tmp,policy);
        }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
        const authorize=async ({phase,recipientId,videoId:observed}={})=>{
          if(!active||!authorized()||recipientId!==contact.id||observed!==videoId||
            !['prepare','monitor','before-click'].includes(phase))return false;
          signal?.throwIfAborted();return true;
        };
        authorize.beginDispatch=()=>{
          if(!active||!authorized())throw Error('scheduled sharing permission revoked');
          signal?.throwIfAborted();
          return ()=>{};
        };
        return await forwarder.forwardAutonomous({recipientId:contact.id,expectedVideoId:videoId},
          {signal,authorize});
      }finally{
        active=false;
        // The receipt ledger is preserved, but an old recipient policy must not
        // become an independent share authorization after a process restart.
        try{fs.writeFileSync(policy,JSON.stringify({allowlist:[]}),{mode:0o600});}catch{}
        if(videoPage&&!videoPage.isClosed())await setMutedPlaying(videoPage,false).catch(()=>{});
      }
    },
    async close(){
      closed=true;active=false;
      await forwarder.close().catch(()=>{});
      if(videoPage&&!videoPage.isClosed())await videoPage.close().catch(()=>{});
    }
  };
}
