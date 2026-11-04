// Scoped video-frame sampling; modelled on dsh-douyin-agent core.mjs
// observeChatSharedWork/captureSharedFrames (MIT). No audio/full-video claim.
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';

const ID=/^\d{1,64}$/;
const reject=why=>Object.assign(Error(why),{code:'VIDEO_SAMPLING_REJECTED'});
const verifyJpeg=data=>{
  if(typeof data!=='string'||data.length<8||data.length>295000||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(data))return false;
  const bytes=Buffer.from(data,'base64');
  return bytes.length>=4&&bytes.length<=220000&&bytes[0]===255&&
    bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217;
};
export function validateSampleTarget({videoId,url,seconds=3}={}){
  if(typeof videoId!=='string'||!ID.test(videoId)||url!==`https://www.douyin.com/video/${videoId}`)
    throw reject('作品链接与作品 ID 未通过一致性核验');
  if(!Number.isFinite(seconds)||seconds<1||seconds>5)throw reject('采样必须在1到5秒之间');
  return {videoId,url,seconds};
}
function assertUrl(page,videoId){
  const current=new URL(page.url());
  const pathId=/^\/video\/(\d{1,64})\/?$/.exec(current.pathname)?.[1];
  const modalId=current.pathname==='/'?current.searchParams.get('modal_id'):null;
  if(current.origin!=='https://www.douyin.com'||(pathId??modalId)!==videoId)
    throw reject('采样标签页已离开指定抖音视频');
}
async function readState(page,handle,id){
  assertUrl(page,id);
  const v=await handle.evaluate(video=>{
    const r=video.getBoundingClientRect(),q=video.getVideoPlaybackQuality?.();
    return {connected:video.isConnected,paused:video.paused,seeking:video.seeking,
      time:video.currentTime,duration:video.duration,readyState:video.readyState,
      playbackRate:video.playbackRate,decodedFrames:q?.totalVideoFrames??null,
      source:video.currentSrc,w:video.videoWidth,h:video.videoHeight,
      rect:{x:Math.max(0,r.left),y:Math.max(0,r.top),
        width:Math.max(0,Math.min(innerWidth,r.right)-Math.max(0,r.left)),
        height:Math.max(0,Math.min(innerHeight,r.bottom)-Math.max(0,r.top))}};
  });
  if(!v?.connected||v.paused||v.seeking||v.readyState<2||
    !Number.isFinite(v.time)||!Number.isFinite(v.duration)||v.duration<=0||
    !Number.isFinite(v.playbackRate)||v.playbackRate<=0||v.playbackRate>2||
    !v.source||v.w<2||v.h<2||v.rect?.width<2||v.rect?.height<2)
    throw reject('播放器未正常播放或解码状态不可信');
  return v;
}
async function frameFromVideo(page,handle,rect){
  let shot=await handle.evaluate(video=>{
    const w=video.videoWidth,h=video.videoHeight,ratio=Math.min(1,960/w,960/h);
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(2,Math.floor(w*ratio));
    canvas.height=Math.max(2,Math.floor(h*ratio));
    try{
      const ctx=canvas.getContext('2d');
      if(!ctx)throw Error('canvas unavailable');
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const data=canvas.toDataURL('image/jpeg',0.55);
      if(!data.startsWith('data:image/jpeg;base64,'))throw Error('invalid canvas image');
      return {data:data.slice(23),method:'video-canvas-jpeg'};
    }catch(error){
      if(error?.name==='SecurityError')return {corsBlocked:true};
      throw error;
    }finally{canvas.width=0;canvas.height=0;}
  });
  if(shot?.corsBlocked){
    // CORS fallback uses selected video's visible rectangle, not network download.
    const cdp=await page.context().newCDPSession(page);
    try{
      const scale=Math.min(1,960/rect.width,960/rect.height);
      const result=await cdp.send('Page.captureScreenshot',{
        format:'jpeg',quality:48,captureBeyondViewport:false,fromSurface:true,
        clip:{x:rect.x,y:rect.y,width:rect.width,height:rect.height,scale}});
      shot={data:result.data,method:'cdp-visible-video-viewport'};
    }finally{await cdp.detach();}
  }
  if(!verifyJpeg(shot?.data))throw reject('视频截图格式或大小超过限制');
  return shot;
}
export async function sampleVideoPage(page,args,{wait=delay}={}){
  const {videoId,url,seconds}=validateSampleTarget(args);
  args.signal?.throwIfAborted();
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
  assertUrl(page,videoId);
  const videos=page.locator('video:visible');
  await videos.first().waitFor({state:'visible',timeout:15000});
  if(await videos.count()!==1)throw reject('多个播放器同时可见，不允许猜测作品');
  const handle=await videos.first().elementHandle();
  if(!handle)throw reject('视频元素不存在');
  let started=false;
  try{
    // The global browser auto-pause guard remains active until the page and
    // exactly one video element have been verified.
    await page.evaluate(()=>{window.__douyinlumaSamplingAuthorized=true;});
    const playing=await handle.evaluate(async video=>{
      video.muted=true;video.volume=0;await video.play();return !video.paused;
    });
    if(!playing)throw reject('浏览器未允许播放作品');
    started=true;
    const wallStart=Date.now(),frames=[];
    let first=null,previous=null,source=null;
    for(let i=0;i<3;i++){
      args.signal?.throwIfAborted();
      if(i)await wait(seconds*500,undefined,{signal:args.signal});
      const before=await readState(page,handle,videoId);
      if(source!==null&&source!==before.source)throw reject('视频播放来源已变化');
      if(previous&&before.time+0.02<previous.time)throw reject('视频时间线跳跃或回环');
      source=before.source;first??=before;
      const shot=await frameFromVideo(page,handle,before.rect);
      const after=await readState(page,handle,videoId);
      if(after.source!==source||after.time+0.02<before.time)throw reject('截图期间视频身份或时间线已变化');
      if(previous&&after.time+0.02<previous.time)throw reject('视频采样时间倒退');
      frames.push({mimeType:'image/jpeg',data:shot.data,videoId,time:before.time,
        captureMethod:shot.method,evidenceHash:createHash('sha256').update(shot.data).digest('hex')});
      previous=after;
    }
    const progress=previous.time-first.time,elapsed=(Date.now()-wallStart)/1000;
    if(progress<0.2||progress>elapsed*2+0.5)throw reject('没有可靠的播放时间推进');
    if(Number.isSafeInteger(first.decodedFrames)&&Number.isSafeInteger(previous.decodedFrames)&&
      previous.decodedFrames<=first.decodedFrames)throw reject('解码帧没有增长');
    return {videoId,url,frames,observation:{requestedSeconds:seconds,
      actualWallSeconds:elapsed,beforeTime:first.time,afterTime:previous.time,
      playbackProgressSeconds:progress,frameCount:3,audioObserved:false,
      fullVideoObserved:false,scope:'three-timed-playback-frames'}};
  }finally{
    if(started)await handle.evaluate(v=>v.pause()).catch(()=>{});
    await page.evaluate(()=>{window.__douyinlumaSamplingAuthorized=false;}).catch(()=>{});
    await handle.dispose().catch(()=>{});
  }
}
export async function sampleSharedVideo(session,args){
  validateSampleTarget(args);args.signal?.throwIfAborted();
  const page=await session.context.newPage();
  try{return await sampleVideoPage(page,args);}
  finally{
    await page.evaluate(()=>{for(const v of document.querySelectorAll('video'))v.pause();}).catch(()=>{});
    await page.close().catch(()=>{});
  }
}
