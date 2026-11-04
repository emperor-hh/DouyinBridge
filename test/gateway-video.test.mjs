import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {AllowlistStore} from '../src/allowlist-store.mjs';
import {Gateway} from '../src/gateway.mjs';
const conv=c=>'conv:'+c.repeat(64),msg=c=>'msg:'+c.repeat(64),member=c=>'member:'+c.repeat(64);
const mkContact=(id,isGroup)=>({id,name:isGroup?'Group':'Friend',displayName:isGroup?'Group':'Friend',
  isGroup,identityVerified:true,identityVersion:2,identityHash:id.slice(5),
  identityKind:'native-conversation',identityBinding:'binding:'+id.slice(5)});
const share=id=>({id,sender:'incoming',text:'',latestEndVerified:true,
 media:{type:'shared-work',videoId:'123456',url:'https://www.douyin.com/video/123456',
  title:'test',identityConflict:false}});
const ask=(id,memberId,mentionedSelf=true)=>({id,sender:'incoming',text:'帮我分析这个视频',
  latestEndVerified:true,memberId,mentionedSelf});
const jpeg=Buffer.from([255,216,255,24,255,217]).toString('base64');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dy-video-gateway-'));
 const db=new AllowlistStore(path.join(dir,'state.sqlite'));
 const priv=mkContact(conv('a'),false),group=mkContact(conv('b'),true);
 const rows=new Map([[priv.id,[share(msg('1'))]],
   [group.id,[{...share(msg('2')),memberId:member('3')}]]]);
 const calls=[],events=[];
 const driver={
   listContacts:async()=>({contacts:[priv,group]}),
   readConversation:async id=>({messages:rows.get(id)}),
   sampleSharedVideo:async({videoId,url})=>{
     calls.push(videoId);
     return {videoId,url,frames:Array.from({length:3},()=>({data:jpeg})),
       observation:{frameCount:3,playbackProgressSeconds:2.9}};
   }
 };
 const gateway=new Gateway({driver,store:{id:()=>101},allowlist:db,
   client:{event:e=>events.push(e)},config:{pollMs:1000,enableSending:false,shareForwarding:true,videoSampleSeconds:3}});
 return {dir,db,priv,group,rows,calls,events,gateway,close(){db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('private and group require independent opt-in and explicit request; sends three frames to AstrBot',async()=>{
 const f=fixture();
 try{
   await f.gateway.refresh();
   f.db.setEnabled(f.priv.id,true);f.db.setEnabled(f.group.id,true);
   f.db.setVideoEnabled(f.priv.id,true);f.db.setVideoEnabled(f.group.id,true);
   await f.gateway.pollOnce();assert.equal(f.calls.length,0); // video card alone
   f.rows.get(f.priv.id).push(ask(msg('4')));
   f.rows.get(f.group.id).push(ask(msg('5'),member('3'),true));
   await f.gateway.pollOnce();
   assert.equal(f.calls.length,2);
   assert.equal(f.events.length,2);
   for(const e of f.events){
     assert.equal(e.message.filter(x=>x.type==='image').length,3);
     assert.match(e.raw_message,/抖音视频实际分时采样/);
     assert.match(e.raw_message,/无音轨/);
   }
   assert.equal(f.events[0].message_type,'private');
   assert.equal(f.events[1].message_type,'group');
   await f.gateway.pollOnce();assert.equal(f.calls.length,2); // no replay
 }finally{f.close();}
});
test('group request without @ or same-member share gets no timed frames',async()=>{
 const f=fixture();
 try{
   await f.gateway.refresh();f.db.setEnabled(f.group.id,true);f.db.setVideoEnabled(f.group.id,true);
   await f.gateway.pollOnce();
   f.rows.get(f.group.id).push(ask(msg('6'),member('7'),true));
   await f.gateway.pollOnce();
   f.rows.get(f.group.id).push(ask(msg('8'),member('3'),false));
   await f.gateway.pollOnce();
   assert.equal(f.calls.length,0);
   assert.equal(f.events.length,2);
   assert.ok(f.events.every(e=>e.message.every(x=>x.type!=='image')));
 }finally{f.close();}
});
test('video permission defaults off; turning it off aborts planned playback',async()=>{
 const f=fixture();
 try{
   await f.gateway.refresh();f.db.setEnabled(f.priv.id,true);await f.gateway.pollOnce();
   f.rows.get(f.priv.id).push(ask(msg('9')));
   await f.gateway.pollOnce();
   assert.equal(f.calls.length,0);
   assert.match(f.events[0].raw_message,/未提供视频采样画面/);
   f.db.setVideoEnabled(f.priv.id,true);
   f.gateway.authorizationChanged(f.priv.id);
   f.rows.get(f.priv.id).push(ask(msg('a')));
   await f.gateway.pollOnce(); // baseline after config change
   f.rows.get(f.priv.id).push(ask(msg('b')));
   await f.gateway.pollOnce();
   assert.equal(f.calls.length,1);
   f.db.setVideoEnabled(f.priv.id,false);f.gateway.authorizationChanged(f.priv.id);
   f.rows.get(f.priv.id).push(ask(msg('c')));
   await f.gateway.pollOnce();
   assert.equal(f.calls.length,1);
 }finally{f.close();}
});
test('persistent quota, cooldown and repeat request guards survive reopening',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dy-video-quota-'));
 const file=path.join(dir,'db.sqlite'),id=conv('f');
 const c=mkContact(id,false),key=x=>'sample:'+x.repeat(64);
 try{
   let db=new AllowlistStore(file);db.upsertContacts([c]);db.setEnabled(id,true);db.setVideoEnabled(id,true);
   assert.equal(db.reserveVideoSample(id,key('1'),{now:1000000}).ok,true);
   assert.equal(db.reserveVideoSample(id,key('1'),{now:1100000}).ok,false);
   assert.equal(db.reserveVideoSample(id,key('2'),{now:1020000}).ok,false);
   db.close();
   db=new AllowlistStore(file);
   assert.equal(db.videoAllowed(id,'private',c.identityBinding),true);
   assert.equal(db.reserveVideoSample(id,key('3'),{now:1200000}).ok,true);
   db.setVideoEnabled(id,false);
   assert.equal(db.reserveVideoSample(id,key('4'),{now:1300000}).ok,false);
   db.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
