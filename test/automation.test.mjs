import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AllowlistStore} from '../src/allowlist-store.mjs';
import {AutomationStore,canonicalVideo,slotDue,validatePlan} from '../src/automation-store.mjs';
import {AutomationScheduler} from '../src/automation-scheduler.mjs';
const conv=c=>'conv:'+c.repeat(64),binding=c=>'binding:'+c.repeat(64);
const contact=(id,isGroup)=>({id,isGroup,name:isGroup?'群聊':'好友',displayName:isGroup?'群聊':'好友',
 identityVerified:true,identityVersion:2,identityKind:isGroup?'rendered-group':'rendered-user',
 identityHash:id.slice(5),identityBinding:binding(id.slice(5,6))});
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'douyinbridge-auto-'));
 const file=path.join(dir,'allowlist.sqlite'),allowed=new AllowlistStore(file);
 const auto=new AutomationStore(allowed);
 const direct=contact(conv('a'),false),group=contact(conv('b'),true);
 allowed.upsertContacts([direct,group]);
 allowed.setEnabled(direct.id,true);allowed.setEnabled(group.id,true);
 return {dir,file,allowed,auto,direct,group,close(){
   allowed.close();fs.rmSync(dir,{recursive:true,force:true});
 }};
}
const planFor=c=>({name:'每日精选',conversationId:c.id,browseAt:'10:00',shareAt:'19:30',
 topic:'',browseCount:3,shareCount:1});
const url=n=>'https://www.douyin.com/video/'+n;

test('strict input validation: exact Douyin URL, time and recipient',()=>{
 assert.deepEqual(canonicalVideo(url('123')),{videoId:'123',url:url('123')});
 for(const bad of [
  'https://www.douyin.com.evil.example/video/123',
  'https://www.douyin.com/video/123?redirect=1',
  'http://www.douyin.com/video/123',
  'https://www.douyin.com/video/abc',
  'https://www.douyin.com/video/123#x'
 ])assert.throws(()=>canonicalVideo(bad));
 assert.throws(()=>validatePlan({...planFor(contact(conv('c'),false)),browseAt:'25:00'}));
 assert.throws(()=>validatePlan({...planFor(contact(conv('c'),false)),shareCount:50}));
 const clock=Date.parse('2026-11-05T02:05:00.000Z');
 assert.equal(slotDue({browseAt:'10:00'},'browse',clock),'2026-11-05');
 assert.equal(slotDue({browseAt:'10:00'},'browse',clock+16*60000),null);
 assert.equal(slotDue({browseAt:'10:00'},'browse',clock-6*60000),null);
});
test('plans default off; candidate dedup and separate per-conversation permission',()=>{
 const f=fixture();
 try{
  const a=f.auto.createPlan(planFor(f.direct));
  const b=f.auto.createPlan(planFor(f.group));
  assert.equal(a.enabled,false);
  assert.equal(b.kind,'group');
  f.auto.setEnabled(a.id,true);
  assert.equal(f.allowed.autoShareAllowed(f.direct.id,'private'),false);
  f.allowed.setAutoShareEnabled(f.direct.id,true);
  assert.equal(f.allowed.autoShareAllowed(f.direct.id,'private',f.direct.identityBinding),true);
  assert.equal(f.allowed.autoShareAllowed(f.group.id,'group'),false);
  assert.equal(f.auto.addCandidates(a.id,[{url:url('123'),title:'工作',author:'A'}]).added,1);
  assert.equal(f.auto.addCandidates(a.id,[{url:url('123')}],{source:'manual'}).added,0);
  assert.equal(f.auto.candidates(a.id).length,1);
  assert.equal(f.auto.reserveDelivery(f.auto.plan(a.id)).ok,true);
  const second=f.auto.reserveDelivery(f.auto.plan(a.id));
  assert.equal(second.ok,false);
  assert.match(second.reason,/unresolved/);
 }finally{f.close();}
});
test('confirmed and uncertain receipts are persisted and never automatically replayed',()=>{
 const f=fixture();
 try{
  const p=f.auto.createPlan(planFor(f.direct));f.auto.setEnabled(p.id,true);
  f.allowed.setAutoShareEnabled(f.direct.id,true);
  f.auto.addCandidates(p.id,[{url:url('123')},{url:url('456')}]);
  const reserved=f.auto.reserveDelivery(f.auto.plan(p.id),{now:200000000});
  assert.equal(reserved.ok,true);
  f.auto.finishDelivery(reserved.deliveryId,{status:'uncertain',note:'unconfirmed'});
  assert.match(f.auto.reserveDelivery(f.auto.plan(p.id),{now:201000000}).reason,/unresolved/);
  f.auto.resolveDelivery(reserved.deliveryId,'confirmed');
  const next=f.auto.reserveDelivery(f.auto.plan(p.id),{now:201900000});
  assert.equal(next.ok,true);
  assert.equal(next.candidate.videoId,'456');
  f.auto.finishDelivery(next.deliveryId,{status:'confirmed',messageId:'msg:ok'});
  const prev=f.auto.deliveries();
  assert.equal(prev.length,2);
  f.allowed.close();
  const reopened=new AllowlistStore(f.file),other=new AutomationStore(reopened);
  assert.equal(other.plans().length,1);
  assert.equal(other.deliveries().length,2);
  assert.equal(other.candidates(p.id).length,2);
  reopened.close();
  // Fixture owns now-closed original db.
  fs.rmSync(f.dir,{recursive:true,force:true});
 }catch(e){if(f.allowed.db.open!==false)try{f.close();}catch{}throw e;}
});
test('schedule ticks browse and share once per Beijing slot, using native receipt',async()=>{
 const f=fixture();
 try{
  const p=f.auto.createPlan(planFor(f.group));
  f.auto.setEnabled(p.id,true);f.allowed.setAutoShareEnabled(f.group.id,true);
  let current=Date.parse('2026-11-05T02:05:00Z'),browseCalls=0,sendCalls=0;
  const driver={
   browseCandidates:async()=>{browseCalls++;return [{videoId:'123',url:url('123'),title:'测试作品',author:'作者'}];},
   forwardNativeVideo:async input=>{
    sendCalls++;assert.equal(input.contact.id,f.group.id);
    assert.equal(input.authorized(),true);
    return {confirmed:true,deliveryUncertain:false,deliveryType:'native-card',
      videoId:input.videoId,messageId:'msg:confirmed'};
   }
  };
  const gateway={
    sendTail:Promise.resolve(),contacts:new Map([[f.group.id,f.group]]),
    isAllowed:c=>f.allowed.allowed(c.id,c.isGroup?'group':'private',c.identityBinding),
    refresh:async()=>{}
  };
  const s=new AutomationScheduler({store:f.auto,allowlist:f.allowed,driver,gateway,
    config:{enableAutoBrowsing:true,enableAutoSharing:true,enableSending:true},
    now:()=>current});
  await s.tick();await s.tick();
  assert.equal(browseCalls,1);assert.equal(f.auto.candidates(p.id).length,1);
  current=Date.parse('2026-11-05T11:35:00Z');
  await s.tick();await s.tick();
  assert.equal(sendCalls,1);
  assert.equal(f.auto.deliveries()[0].status,'confirmed');
  assert.deepEqual(f.auto.slots().map(x=>x.status).sort(),['completed','completed']);
  await s.stop();
 }finally{f.close();}
});
test('global share gate and per-recipient revoke prevent delivery',async()=>{
 const f=fixture();
 try{
  const p=f.auto.createPlan(planFor(f.direct));f.auto.setEnabled(p.id,true);
  f.allowed.setAutoShareEnabled(f.direct.id,true);
  f.auto.addCandidates(p.id,[{url:url('567')}]);
  let called=0;
  const gateway={sendTail:Promise.resolve(),contacts:new Map([[f.direct.id,f.direct]]),
   isAllowed:c=>f.allowed.allowed(c.id,'private',c.identityBinding),refresh:async()=>{}};
  const driver={browseCandidates:async()=>[],forwardNativeVideo:async()=>{called++;return null;}};
  const scheduler=new AutomationScheduler({store:f.auto,allowlist:f.allowed,driver,gateway,
   config:{enableAutoBrowsing:true,enableAutoSharing:false,enableSending:true}});
  await assert.rejects(()=>scheduler.exclusive(p.id,'share',signal=>
    scheduler.share(f.auto.plan(p.id),signal)),/总开关/);
  f.allowed.setAutoShareEnabled(f.direct.id,false);
  scheduler.config.enableAutoSharing=true;
  await assert.rejects(()=>scheduler.exclusive(p.id,'share',signal=>
    scheduler.share(f.auto.plan(p.id),signal)),/权限尚未核实/);
  assert.equal(called,0);
  await scheduler.stop();
 }finally{f.close();}
});
