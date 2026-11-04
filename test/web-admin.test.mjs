import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {AllowlistStore} from '../src/allowlist-store.mjs';
import {startAdmin} from '../src/web-admin.mjs';

test('admin API is authenticated and can toggle group and private dynamically',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'douyinluma-admin-'));
 const db=new AllowlistStore(path.join(dir,'state.sqlite'));
 const group={id:'conv:'+'a'.repeat(64),isGroup:true,displayName:'Team',identityVerified:true,
 identityVersion:2,identityKind:'rendered-group',identityHash:'a'.repeat(64),identityBinding:'binding:'+'b'.repeat(64)};
 const friend={...group,id:'conv:'+'c'.repeat(64),displayName:'Friend',isGroup:false,identityKind:'native-conversation',
 identityHash:'c'.repeat(64),identityBinding:'binding:'+'d'.repeat(64)};
 db.upsertContacts([group,friend]);
 let updates=0;
 const gateway={running:true,lastScan:null,lastScanError:null,isScanning:()=>false,
   refresh:async()=>({count:2,scannedToEnd:true}),authorizationChanged:()=>updates++};
 const app=await startAdmin({gateway,store:db,port:0,token:'0123456789abcdef0123456789abcdef'});
 try{
  const base=app.url;
  let r=await fetch(base+'api/conversations');
  assert.equal(r.status,401);
  const headers={Authorization:'Bearer 0123456789abcdef0123456789abcdef'};
  r=await fetch(base+'api/conversations',{headers});
  assert.equal(r.status,200);assert.equal((await r.json()).items.length,2);
  r=await fetch(base+'api/conversations/'+encodeURIComponent(group.id),{
    method:'PUT',headers:{...headers,'Content-Type':'application/json',Origin:'https://evil.example'},
    body:JSON.stringify({enabled:true})});
  assert.equal(r.status,403);
  r=await fetch(base+'api/conversations/'+encodeURIComponent(group.id),{
    method:'PUT',headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({enabled:true})});
  assert.equal(r.status,200);
  assert.equal(db.allowed(group.id,'group'),true);
  assert.equal(db.allowed(friend.id,'private'),false);
  assert.equal(updates,1);
  assert.equal(db.list().find(x=>x.id===group.id).coverEnabled,false);
  r=await fetch(base+'api/conversations/'+encodeURIComponent(group.id)+'/cover',{
    method:'PUT',headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({enabled:true})});
  assert.equal(r.status,200);
  assert.equal(db.coverAllowed(group.id,'group',group.identityBinding),true);
  assert.equal(db.coverAllowed(friend.id,'private',friend.identityBinding),false);
  assert.equal(updates,1); // cover setting must not replay old messages
  r=await fetch(base+'api/conversations/'+encodeURIComponent(group.id)+'/video',{
    method:'PUT',headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({enabled:true})});
  assert.equal(r.status,200);
  assert.equal(db.videoAllowed(group.id,'group',group.identityBinding),true);
  assert.equal(db.videoAllowed(friend.id,'private'),false);
  assert.equal(updates,2);
  r=await fetch(base+'api/conversations/'+encodeURIComponent(group.id)+'/video',{
    method:'PUT',headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({enabled:'invalid'})});
  assert.equal(r.status,400);
  r=await fetch(base+'api/conversations/'+encodeURIComponent(group.id)+'/cover',{
    method:'PUT',headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({enabled:'yes'})});
  assert.equal(r.status,400);
 }finally{await app.close();db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
