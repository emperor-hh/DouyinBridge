import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {AllowlistStore} from '../src/allowlist-store.mjs';
import {AutomationStore} from '../src/automation-store.mjs';
import {AutomationScheduler} from '../src/automation-scheduler.mjs';
import {startAdmin} from '../src/web-admin.mjs';
test('automation management is protected and manual candidate/permissions persist',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dyl-automation-api-'));
 const allowed=new AllowlistStore(path.join(dir,'allow.sqlite'));
 const contact={id:'conv:'+'a'.repeat(64),isGroup:false,identityVerified:true,identityVersion:2,
   identityKind:'rendered-user',identityHash:'a'.repeat(64),identityBinding:'binding:'+'b'.repeat(64),
   name:'测试好友',displayName:'测试好友'};
 allowed.upsertContacts([contact]);allowed.setEnabled(contact.id,true);
 const store=new AutomationStore(allowed);
 const gateway={running:true,contacts:new Map([[contact.id,contact]]),
   lastScan:null,lastScanError:null,isScanning:()=>false,refresh:async()=>({count:1}),
   authorizationChanged:()=>{},sendTail:Promise.resolve(),isAllowed:()=>true};
 const scheduler=new AutomationScheduler({store,allowlist:allowed,gateway,driver:{},
   config:{enableAutoBrowsing:false,enableAutoSharing:false,enableSending:false}});
 const token='012345678901234567890123456789ab';
 const admin=await startAdmin({gateway,store:allowed,automation:scheduler,port:0,token});
 try{
  const base=admin.url,headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  let r=await fetch(base+'api/automation');assert.equal(r.status,401);
  r=await fetch(base+'api/automation',{headers});assert.equal(r.status,200);
  assert.deepEqual((await r.json()).plans,[]);
  r=await fetch(base+'api/automation/plans',{
   method:'POST',headers,body:JSON.stringify({name:'测试计划',conversationId:contact.id,
     browseAt:'10:00',shareAt:'19:30',topic:'',browseCount:3,shareCount:1})});
  assert.equal(r.status,201);const {plan}=await r.json();assert.equal(plan.enabled,false);
  r=await fetch(base+'api/automation/plans/'+plan.id+'/candidates',{
   method:'POST',headers,body:JSON.stringify({url:'https://www.douyin.com/video/123456'})});
  assert.equal(r.status,200);assert.equal((await r.json()).added,1);
  r=await fetch(base+'api/automation/plans/'+plan.id,{
   method:'PUT',headers,body:JSON.stringify({enabled:true})});
  assert.equal(r.status,200);
  r=await fetch(base+'api/automation/plans/'+plan.id+'/browse',{method:'POST',headers});
  assert.equal(r.status,409); // browsing env flag disabled
  r=await fetch(base+'api/conversations/'+encodeURIComponent(contact.id)+'/auto-share',{
   method:'PUT',headers,body:JSON.stringify({enabled:true})});
  assert.equal(r.status,200);assert.equal(allowed.autoShareAllowed(contact.id,'private'),true);
  r=await fetch(base+'api/automation',{headers});
  const all=await r.json();assert.equal(all.candidates[plan.id].length,1);
  assert.equal(all.plans[0].enabled,true);
 }finally{
  await admin.close();await scheduler.stop();allowed.close();
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
