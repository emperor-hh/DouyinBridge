import { test } from 'node:test';
import assert from 'node:assert/strict';
import {summarizeContactListing,formatContactListing} from '../src/contact-list.mjs';

const id='conv:'+'a'.repeat(64);
const binding='binding:'+'b'.repeat(64);
test('lists stable private and group contacts without allowlist',()=>{
  const d=summarizeContactListing({contacts:[
    {id,identityVerified:true,identityVersion:2,identityBinding:binding,isGroup:true,displayName:'开发测试群'},
    {id:'昵称冒充的ID',identityVerified:false,isGroup:false,displayName:'朋友'}
  ],listDiscovery:{scannedToEnd:true}});
  assert.equal(d.totalCount,2);
  assert.equal(d.usableCount,1);
  assert.equal(d.allowlist,id);
  assert.equal(d.contacts.find(c=>c.name==='朋友').id,null);
  assert.match(formatContactListing(d),/开发测试群/);
});
test('empty list and incomplete scan are explicit',()=>{
  const d=summarizeContactListing({contacts:[],listDiscovery:{scannedToEnd:false,reason:'页面列表未加载'}});
  assert.equal(d.totalCount,0);
  assert.equal(d.scannedToEnd,false);
  assert.match(formatContactListing(d),/未确认/);
});
test('invalid list is not silently treated as empty',()=>{
  assert.throws(()=>summarizeContactListing({blocked:true}),/未获取到会话列表/);
});
