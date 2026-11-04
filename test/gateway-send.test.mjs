import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Gateway} from '../src/gateway.mjs';
test('allowlisted sends carry upstream authorization and identity binding',async()=>{
 for(const isGroup of [false,true]){
  const contact={id:'conv:'+'a'.repeat(64),name:'test',isGroup,relationshipStatus:'unavailable',followed:false,identityVerified:true,identityVersion:2,identityKind:isGroup?'rendered-group':'rendered-user',identityHash:'a'.repeat(64),identityBinding:'binding:'+'b'.repeat(64)};
  let sent;
  const gateway=new Gateway({driver:{listContacts:async()=>[contact],readConversation:async()=>({messages:[{id:'m1'}]}),sendMessage:async(...args)=>{sent=args;return {confirmed:true,messageId:'sent1'};}},store:{id:()=>1,lookup:()=>contact.id},client:{},allowlist:{upsertContacts:()=>{},allowed:()=>true},config:{allowlist:new Set([contact.id]),enableSending:true}});
  await gateway.refresh();await gateway.send(isGroup?'group':'private',1,'hello');
  assert.equal(sent[2].expectedContact.authorizationKind,isGroup?'existing-group':'existing-conversation');
  assert.ok(Number.isFinite(Date.parse(sent[2].expectedContact.verifiedAt)));
  assert.equal(sent[2].expectedContact.identityBinding,contact.identityBinding);
  assert.deepEqual(sent[2].expectedMessageIds,['m1']);
  gateway.contacts.clear();sent=undefined;
  await assert.rejects(gateway.send(isGroup?'group':'private',1,'hello'),/no longer authorized/);
  assert.equal(sent,undefined);
 }
});