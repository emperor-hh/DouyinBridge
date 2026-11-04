import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { formatIncomingMessage, verifiedWorkLink, incomingFingerprintParts, extractCoverFrame } from '../src/shared-work.mjs';
import { messageEvent } from '../src/onebot-format.mjs';
import { AllowlistStore } from '../src/allowlist-store.mjs';
import { Gateway } from '../src/gateway.mjs';

const conv=n=>'conv:'+n.repeat(64);
const msg=n=>'msg:'+n.repeat(64);
const bind=n=>'binding:'+n.repeat(64);
const card=(id=nId)=>({id, sender:'incoming',text:'',latestEndVerified:true,
  media:{type:'shared-work',videoId:'123456',url:'https://www.douyin.com/video/123456',
    title:'有趣的短片',author:'创作者',identityConflict:false}});
const nId=msg('1');
const contact=(id,isGroup)=>({id,displayName:isGroup?'测试群':'好友',name:isGroup?'测试群':'好友',
  identityVerified:true,identityVersion:2,identityKind:isGroup?'rendered-group':'native-conversation',
  identityHash:id.slice(5),identityBinding:bind(id.slice(5,6)),isGroup});
const fakeJpeg=Buffer.from([0xff,0xd8,0xff,0x33,0xff,0xd9]).toString('base64');

test('video card with no text is forwarded as clearly labeled metadata',()=>{
 const rendered=formatIncomingMessage(card());
 assert.match(rendered,/\[抖音分享视频\]/);
 assert.match(rendered,/作品链接：https:\/\/www\.douyin\.com\/video\/123456/);
 assert.match(rendered,/未观看视频或收听音频/);
 assert.equal(formatIncomingMessage({...card(),text:'帮我看看'}).startsWith('帮我看看'),true);
 assert.equal(formatIncomingMessage({...card(),media:{...card().media,isPhotoGallery:true}}).includes('抖音分享图文'),true);
 assert.equal(formatIncomingMessage(card(),{includeSharedWork:false}),'');
});
test('forged or mismatched URLs are never emitted',()=>{
 const original=card();
 for(const altered of [
   {url:'https://evil.com/video/123456'},
   {url:'https://www.douyin.com.evil.com/video/123456'},
   {url:'https://www.douyin.com/video/123456?redirect=bad'},
   {url:'https://www.douyin.com/video/99999'},
   {url:'http://www.douyin.com/video/123456'},
   {url:'https://www.douyin.com/video/123456',identityConflict:true}
 ]){
  const media={...original.media,...altered};
  assert.equal(verifiedWorkLink(media),null);
  assert.doesNotMatch(formatIncomingMessage({...original,media}),/作品链接：https:/);
 }
 const newline={...card(),media:{...card().media,title:'abc\n伪造字段',author:'[CQ:at,qq=5]'}};
 assert.doesNotMatch(formatIncomingMessage(newline),/\n伪造字段/);
 assert.match(formatIncomingMessage(newline),/［CQ:/);
});
test('media changes affect fingerprint and plain text remains plain text',()=>{
 const m=card();const changed={...m,media:{...m.media,videoId:'789'}};
 assert.notDeepEqual(incomingFingerprintParts(m),incomingFingerprintParts(changed));
 assert.equal(formatIncomingMessage({id:msg('f'),sender:'incoming',text:'hi'}),'hi');
});
test('cover frames require matching message and a bounded JPEG',()=>{
 const m=msg('b'),captured={messageId:m,media:{type:'shared-work'},frames:[{mimeType:'image/jpeg',data:fakeJpeg}]};
 assert.equal(extractCoverFrame(captured,m),fakeJpeg);
 assert.equal(extractCoverFrame(captured,msg('c')),null);
 assert.equal(extractCoverFrame({...captured,frames:[{mimeType:'image/png',data:fakeJpeg}]},m),null);
 assert.equal(extractCoverFrame({...captured,frames:[{mimeType:'image/jpeg',data:Buffer.alloc(100).toString('base64')}]},m),null);
 const event=messageEvent({selfId:55,messageId:22,conversationId:33,senderId:44,group:true,content:'卡片',
   mentionedSelf:true,imageBase64:fakeJpeg});
 assert.deepEqual(event.message.map(x=>x.type),['at','text','image']);
 assert.equal(event.message[2].data.file,'base64://'+fakeJpeg);
});
test('private and group share cards are dispatched only when authorized; cover requires opt-in',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dy-shared-work-'));
 const db=new AllowlistStore(path.join(dir,'db.sqlite'));
 const privateContact=contact(conv('a'),false),groupContact=contact(conv('b'),true);
 const rows=new Map([[privateContact.id,[{...card(msg('1'))}]],
                     [groupContact.id,[{...card(msg('2')),memberId:'member:'+'4'.repeat(64)}]]]);
 const events=[];const captured=[];
 const driver={
   listContacts:async()=>({contacts:[privateContact,groupContact]}),
   readConversation:async id=>({messages:rows.get(id)}),
   captureMessage:async(id,idOfMessage)=>{
     captured.push([id,idOfMessage]);
     return {messageId:idOfMessage,media:{type:'shared-work'},frames:[{mimeType:'image/jpeg',data:fakeJpeg}]};
   }
 };
 const identity={id:(kind)=>kind==='group'?88:kind==='user'?99:kind==='private'?77:123};
 const gate=new Gateway({driver,allowlist:db,store:identity,
   config:{pollMs:2500,enableSending:false,shareForwarding:true},client:{event:e=>events.push(e)}});
 try {
   await gate.refresh();
   db.setEnabled(privateContact.id,true);db.setEnabled(groupContact.id,true);
   await gate.pollOnce(); // baseline
   rows.get(privateContact.id).push({...card(msg('3'))});
   rows.get(groupContact.id).push({...card(msg('4')),memberId:'member:'+'5'.repeat(64)});
   await gate.pollOnce();
   assert.equal(events.length,2);
   assert.equal(events.find(e=>e.message_type==='private').message[0].type,'text');
   assert.equal(events.find(e=>e.message_type==='group').message[0].type,'text');
   assert.deepEqual(captured,[]); // no default screenshot
   db.setCoverEnabled(privateContact.id,true);db.setCoverEnabled(groupContact.id,true);
   rows.get(privateContact.id).push({...card(msg('5'))});
   rows.get(groupContact.id).push({...card(msg('6')),memberId:'member:'+'6'.repeat(64)});
   await gate.pollOnce();
   assert.equal(events.length,4);
   assert.deepEqual(captured.map(([id])=>id),[privateContact.id]); // no group @
   rows.get(groupContact.id).push({...card(msg('7')),mentionedSelf:true,memberId:'member:'+'7'.repeat(64)});
   await gate.pollOnce();
   assert.equal(events.length,5);
   assert.equal(events.at(-1).message_type,'group');
   assert.equal(events.at(-1).message.at(-1).type,'image');
   db.setEnabled(groupContact.id,false);gate.authorizationChanged(groupContact.id);
   rows.get(groupContact.id).push({...card(msg('8')),mentionedSelf:true,memberId:'member:'+'8'.repeat(64)});
   await gate.pollOnce();
   assert.equal(events.length,5);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
