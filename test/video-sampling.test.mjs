import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {validateSampleTarget,sampleVideoPage} from '../src/video-sampler.mjs';
import {selectRequestedVideo,formatSampleEvidence} from '../src/video-trigger.mjs';

const jpeg=Buffer.from([255,216,255,16,255,217]).toString('base64');
const msg=n=>'msg:'+n.repeat(64);
const member=n=>'member:'+n.repeat(64);
const media={type:'shared-work',videoId:'123456',url:'https://www.douyin.com/video/123456',
 title:'sample',identityConflict:false};
const card=(id,memberId)=>({id,sender:'incoming',text:'',media,memberId});
const request=(id,memberId,mention=true)=>({id,sender:'incoming',text:'帮我分析这个视频',memberId,mentionedSelf:mention});

test('only explicit request may select a card and group requires @ plus same member',()=>{
 const a=card(msg('a'),member('1'));
 const b=request(msg('b'),member('1'),true);
 assert.equal(selectRequestedVideo([a,b],1,{group:true}).card.id,a.id);
 assert.equal(selectRequestedVideo([a,{...b,mentionedSelf:false}],1,{group:true}),null);
 assert.equal(selectRequestedVideo([a,{...b,memberId:member('2')}],1,{group:true}),null);
 assert.equal(selectRequestedVideo([a,{...b,text:'今天天气如何'}],1,{group:true}),null);
 assert.equal(selectRequestedVideo([a],0,{group:false}),null);
 assert.equal(selectRequestedVideo([a,b],1,{group:false}).card.id,a.id);
 assert.equal(selectRequestedVideo([a,{id:msg('c'),sender:'outgoing',text:'ok'},b],2,{group:false}),null);
 assert.equal(selectRequestedVideo([{...a,media:{...media,isPhotoGallery:true}},b],1,{group:false}),null);
});

test('target validation rejects foreign hosts, mismatched IDs, unsupported seconds',()=>{
 assert.deepEqual(validateSampleTarget({videoId:'123456',url:'https://www.douyin.com/video/123456',seconds:3}),
   {videoId:'123456',url:'https://www.douyin.com/video/123456',seconds:3});
 for(const value of [
   {videoId:'123456',url:'https://other.site/video/123456'},
   {videoId:'123456',url:'https://www.douyin.com/video/999'},
   {videoId:'123456',url:'https://www.douyin.com/video/123456?x=1'},
   {videoId:'123456',url:'https://www.douyin.com/video/123456',seconds:30}
 ])assert.throws(()=>validateSampleTarget(value));
});

function stub({otherUrl=false,cors=false,multiple=false}={}){
 let url='about:blank',time=0,muted=false,paused=false,disposed=false,closed=false,allow=false,cdpDetached=false;
 const state=()=>({connected:true,paused:false,seeking:false,time,duration:200,readyState:4,
   playbackRate:1,decodedFrames:Math.floor(time*30),source:'https://video.example/stream',
   w:640,h:360,rect:{x:0,y:0,width:640,height:360}});
 const handle={evaluate:async fn=>{
   const source=String(fn);
   if(source.includes('video.getBoundingClientRect'))return state();
   if(source.includes("document.createElement('canvas')"))
     return cors?{corsBlocked:true}:{data:jpeg,method:'video-canvas-jpeg'};
   if(source.includes('video.muted=true')){muted=true;return true;}
   if(source.includes('v.pause()')){paused=true;return undefined;}
   throw Error('unexpected handle.evaluate: '+source.slice(0,80));
 },dispose:async()=>{disposed=true;}};
 const locator={first:()=>({waitFor:async()=>{},elementHandle:async()=>handle}),
   count:async()=>multiple?2:1};
 const page={goto:async target=>{url=otherUrl?'https://elsewhere.example/video/123456':target;},
   url:()=>url,locator:selector=>{assert.equal(selector,'[data-e2e="player-container"].video_123456 video:visible');return locator;},
   evaluate:async fn=>{
     const source=String(fn);
     if(source.includes('__douyinlumaSamplingAuthorized=true'))allow=true;
     if(source.includes('__douyinlumaSamplingAuthorized=false'))allow=false;
   },
   context:()=>({newCDPSession:async()=>({
      send:async()=>({data:jpeg}),detach:async()=>{cdpDetached=true;}
   })}),
   close:async()=>{closed=true;}};
 return {page,delay:async ms=>{await delay(ms);time+=0.6;},
   status:()=>({muted,paused,disposed,closed,allow,cdpDetached})};
}
test('three actual time-separated video frames, source and progress are verified',async()=>{
 const f=stub();
 const observation=await sampleVideoPage(f.page,
   {videoId:'123456',url:'https://www.douyin.com/video/123456',seconds:1},{wait:f.delay});
 assert.equal(observation.frames.length,3);
 assert.ok(observation.observation.playbackProgressSeconds>1);
 assert.equal(observation.observation.audioObserved,false);
 assert.equal(observation.observation.fullVideoObserved,false);
 assert.deepEqual(observation.frames.map(x=>x.time),[0,0.6,1.2]);
 assert.equal(f.status().muted,true);assert.equal(f.status().paused,true);
 assert.equal(f.status().disposed,true);assert.equal(f.status().allow,false);
 assert.match(formatSampleEvidence(observation),/无音轨/);
});
test('canvas CORS fallback is scoped to video viewport and uses CDP JPEG',async()=>{
 const f=stub({cors:true});
 const r=await sampleVideoPage(f.page,
   {videoId:'123456',url:'https://www.douyin.com/video/123456',seconds:1},{wait:f.delay});
 assert.equal(r.frames[0].captureMethod,'cdp-visible-video-viewport');
 assert.equal(f.status().cdpDetached,true);
});
test('foreign pages and ambiguous players never trigger playback',async()=>{
 for(const opts of [{otherUrl:true},{multiple:true}]){
   const f=stub(opts);
   await assert.rejects(()=>sampleVideoPage(f.page,
     {videoId:'123456',url:'https://www.douyin.com/video/123456',seconds:1},{wait:f.delay}));
   assert.equal(f.status().muted,false);
 }
});

test('natural explicit watch requests trigger sampling but statements do not',()=>{
 const a=card(msg('a'),member('1'));
 for(const text of ['@科诺 看这个视频','@科诺 看视频','请看这条视频','帮我看这个视频','看一下这个视频']){
  assert.ok(selectRequestedVideo([a,{...request(msg('b'),member('1')),text}],1,{group:true}),text);
 }
 for(const text of ['我在看这个视频','别看这个视频','这个视频很好看']){
  assert.equal(selectRequestedVideo([a,{...request(msg('b'),member('1')),text}],1,{group:true}),null,text);
 }
});