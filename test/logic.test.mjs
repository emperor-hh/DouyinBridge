import {test} from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';import fs from 'node:fs';import path from 'node:path';
import {IdentityStore} from '../src/identity.mjs';
import {messageEvent,textSegments} from '../src/onebot-format.mjs';
import {validatedContact} from '../src/douyin-driver.mjs';
import {configFromEnv} from '../src/config.mjs';
test('persistent ids and separated namespaces',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dyl-'));const p=path.join(dir,'map.json');
  const a=new IdentityStore(p);const uid=a.id('user','abc');
  assert.notEqual(uid,a.id('group','abc'));
  assert.equal(new IdentityStore(p).id('user','abc'),uid);
  fs.rmSync(dir,{recursive:true,force:true});
});
test('onebot event conversion',()=>{
  const e=messageEvent({selfId:42,messageId:1,conversationId:2,senderId:3,content:'hi',group:true,mentionedSelf:true});
  assert.equal(e.message_type,'group');assert.equal(e.message[0].type,'at');assert.equal(e.group_id,2);
});
test('only text replies supported',()=>{
  assert.equal(textSegments([{type:'text',data:{text:'hi'}}]),'hi');
  assert.throws(()=>textSegments([{type:'image',data:{file:'x'}}]));
});
test('stable identity requirement',()=>{
  assert.equal(validatedContact({id:'conv:'+'a'.repeat(64),identityVerified:true,identityVersion:2,identityBinding:'binding:'+'b'.repeat(64),isGroup:true}),true);
  assert.equal(validatedContact({id:'Bob',isGroup:true}),false);
});
test('default disables sends and empty allowlist',()=>{
  const c=configFromEnv({});assert.equal(c.enableSending,false);assert.equal(c.allowlist.size,0);
});
