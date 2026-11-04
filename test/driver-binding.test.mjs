import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVerifiedChatBrowser} from '../src/douyin-driver.mjs';
test('manual whitelist approval still requires exact live identity binding',async()=>{
 const expected={id:'conv:'+'a'.repeat(64),name:'test',isGroup:false,identityVerified:true,identityVersion:2,identityKind:'rendered-user',identityHash:'a'.repeat(64),identityBinding:'binding:'+'b'.repeat(64),authorizationKind:'manual',relationshipStatus:'unverified'};
 let current={...expected};let upstreamChecks=0;
 class Chat {async verifyContactBinding(){upstreamChecks++;return current;}}
 const chat=createVerifiedChatBrowser(Chat,{});
 assert.deepEqual(await chat.verifyContactBinding(null,expected,expected),expected);
 for(const change of [{identityBinding:'binding:'+'c'.repeat(64)},{identityVerified:false},{isGroup:true},{identityHash:'c'.repeat(64)},{id:'conv:'+'c'.repeat(64)}]){
  current={...expected,...change};
  await assert.rejects(chat.verifyContactBinding(null,expected,expected),/绑定已变化/);
 }
 assert.equal(upstreamChecks,6);
});