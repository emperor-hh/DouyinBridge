import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {AllowlistStore} from '../src/allowlist-store.mjs';
import {DatabaseSync} from 'node:sqlite';
import {Gateway} from '../src/gateway.mjs';

const conv=l=>'conv:'+l.repeat(64);
const binding=l=>'binding:'+l.repeat(64);
const contact=(id,isGroup,name)=>({
 id,identityVerified:true,identityVersion:2,identityKind:isGroup?'rendered-group':'native-conversation',
 identityHash:id.slice(5),identityBinding:binding(id.slice(5,6)),isGroup,displayName:name,name
});
function fixture(legacyAllowlist=[]){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'douyinbridge-test-'));
 const db=new AllowlistStore(path.join(dir,'allowed.sqlite'),{legacyAllowlist});
 return {db,close(){db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('private and group have independent dynamic controls and persistence',()=>{
 const f=fixture();
 try{
  const a=contact(conv('a'),false,'Alice'),b=contact(conv('b'),true,'Group');
  f.db.upsertContacts([a,b]);
  assert.equal(f.db.list().length,2);
  assert.equal(f.db.allowed(a.id,'private'),false);
  assert.equal(f.db.allowed(b.id,'group'),false);
  f.db.setEnabled(a.id,true);
  assert.equal(f.db.allowed(a.id,'private',a.identityBinding),true);
  assert.equal(f.db.allowed(b.id,'group',b.identityBinding),false);
  f.db.setEnabled(b.id,true);
  f.db.setEnabled(a.id,false);
  assert.equal(f.db.allowed(a.id,'private'),false);
  assert.equal(f.db.allowed(b.id,'group'),true);
  f.db.upsertContacts([{...a,displayName:'Alice New'},b]);
  assert.equal(f.db.allowed(a.id,'private'),false);
  assert.equal(f.db.allowed(b.id,'private'),false);
  assert.equal(f.db.list().find(x=>x.id===a.id).name,'Alice New');
 }finally{f.close();}
});
test('invalid identity and ID collisions cannot auto authorize',()=>{
 const f=fixture();
 try{
  const a=contact(conv('c'),false,'Verified');
  f.db.upsertContacts([{...a,identityVerified:false},a]);
  assert.equal(f.db.list().length,1);
  f.db.setEnabled(a.id,true);
  f.db.upsertContacts([{...a,isGroup:true,identityKind:'rendered-group'}]);
  assert.equal(f.db.allowed(a.id,'group'),false);
  assert.equal(f.db.allowed(a.id,'private'),true);
  assert.throws(()=>f.db.setEnabled('nickname',true));
  assert.throws(()=>f.db.setEnabled(conv('d'),true));
 }finally{f.close();}
});
test('legacy env allowlist is a one-time migration only',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'douyinbridge-migrate-'));
 const filename=path.join(dir,'allow.sqlite'),a=contact(conv('e'),false,'test');
 try{
  let db=new AllowlistStore(filename,{legacyAllowlist:[a.id]});
  db.upsertContacts([a]);assert.equal(db.allowed(a.id,'private'),true);
  db.setEnabled(a.id,false);db.close();
  db=new AllowlistStore(filename,{legacyAllowlist:[a.id]});
  db.upsertContacts([a]);
  assert.equal(db.allowed(a.id,'private'),false);db.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('private messages honor revocation without restarting',async()=>{
 const f=fixture();
 try{
  const a=contact(conv('f'),false,'friend');
  let data=[{id:'msg:1',sender:'incoming',text:'hello',latestEndVerified:true}];
  const emitted=[];
  const driver={listContacts:async()=>({contacts:[a]}),readConversation:async()=>({messages:data}),
    sendMessage:async()=>({confirmed:true,messageId:'1'})};
  const identity={id:()=>101,lookup:()=>a.id};
  const config={pollMs:1000,enableSending:true};
  const gateway=new Gateway({driver,store:identity,allowlist:f.db,config,client:{event:e=>emitted.push(e)}});
  await gateway.pollOnce();
  f.db.setEnabled(a.id,true);gateway.authorizationChanged(a.id);
  await gateway.pollOnce();assert.equal(emitted.length,0);
  data=[...data,{id:'msg:2',sender:'incoming',text:'new message',latestEndVerified:true}];
  await gateway.pollOnce();assert.equal(emitted.length,1);
  f.db.setEnabled(a.id,false);gateway.authorizationChanged(a.id);
  data=[...data,{id:'msg:3',sender:'incoming',text:'not allowed',latestEndVerified:true}];
  await gateway.pollOnce();assert.equal(emitted.length,1);
  await assert.rejects(()=>gateway.send('private',101,'reply'),/no longer authorized/);
 }finally{f.close();}
});
test('group messages use group ID and verified member ID only',async()=>{
 const f=fixture();
 try{
  const c=contact(conv('a'),true,'测试群');
  let data=[{id:'msg:1',sender:'incoming',text:'a',memberId:'member:'+'e'.repeat(64),latestEndVerified:true}];
  const emitted=[],identity={id:(kind)=>kind==='group'?123:kind==='user'?45:99};
  const gateway=new Gateway({driver:{listContacts:async()=>({contacts:[c]}),readConversation:async()=>({messages:data})},
    store:identity,allowlist:f.db,config:{pollMs:2000,enableSending:false},client:{event:e=>emitted.push(e)}});
  await gateway.refresh();f.db.setEnabled(c.id,true);gateway.authorizationChanged(c.id);
  await gateway.pollOnce();
  data=[...data,{id:'msg:2',sender:'incoming',text:'new group text',memberId:'member:'+'f'.repeat(64),latestEndVerified:true}];
  await gateway.pollOnce();
  assert.equal(emitted.length,1);assert.equal(emitted[0].message_type,'group');
  assert.equal(emitted[0].group_id,123);assert.equal(emitted[0].user_id,45);
 }finally{f.close();}
});

test('pre-v0.4 SQLite schemas migrate without changing existing approvals',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'douyinbridge-old-db-'));
 const filename=path.join(dir,'state.sqlite');
 const a=contact(conv('d'),true,'旧群聊');
 try{
   const db=new DatabaseSync(filename);
   db.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
     CREATE TABLE conversations(
       id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,
       identity_binding TEXT NOT NULL,identity_kind TEXT NOT NULL,
       enabled INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);`);
   db.prepare('INSERT INTO conversations(id,kind,name,identity_binding,identity_kind,enabled,updated_at) VALUES(?,?,?,?,?,?,?)')
     .run(a.id,'group',a.name,a.identityBinding,a.identityKind,1,new Date().toISOString());
   db.close();
   const reopened=new AllowlistStore(filename);
   assert.equal(reopened.allowed(a.id,'group'),true);
   assert.equal(reopened.coverAllowed(a.id,'group'),false);
   assert.equal(reopened.videoAllowed(a.id,'group'),false);
   assert.equal(reopened.stickerAllowed(a.id,'group'),false);
   reopened.setStickerEnabled(a.id,true);
   assert.equal(reopened.stickerAllowed(a.id,'group',a.identityBinding),true);
   reopened.setVideoEnabled(a.id,true);
   assert.equal(reopened.videoAllowed(a.id,'group',a.identityBinding),true);
   reopened.setCoverEnabled(a.id,true);
   assert.equal(reopened.coverAllowed(a.id,'group'),true);
   reopened.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
