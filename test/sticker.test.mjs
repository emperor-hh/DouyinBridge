import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseOutgoingMessage,decodeImageSegment,stickerLabel,extractStickerFrame} from '../src/sticker.mjs';
import {incomingFingerprintParts} from '../src/shared-work.mjs';
import {AllowlistStore} from '../src/allowlist-store.mjs';
import {Gateway} from '../src/gateway.mjs';

const conv=c=>'conv:'+c.repeat(64),msg=c=>'msg:'+c.repeat(64);
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,12,73,72,68,82,0,0]);
const jpeg=Buffer.from([255,216,255,224,0,10,74,70,73,70,0,1,255,217]);
const sample=(type='image')=>({type,data:{file:'base64://'+png.toString('base64')}});
const contact=(id,group)=>({id,isGroup:group,identityVerified:true,identityVersion:2,
  identityKind:group?'rendered-group':'rendered-user',identityHash:id.slice(5),
  identityBinding:'binding:'+id.slice(5),name:group?'测试群':'测试好友'});
function fixture(){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dyl-sticker-'));
 const allowlist=new AllowlistStore(path.join(folder,'allow.sqlite'));
 return {allowlist,close(){allowlist.close();fs.rmSync(folder,{force:true,recursive:true});}};
}

test('OneBot image sends decode to content-hashed bounded PNG asset',()=>{
 const value=parseOutgoingMessage([sample()]);
 assert.equal(value.type,'image');assert.equal(value.asset.extension,'png');
 assert.equal(value.asset.mimeType,'image/png');
 assert.deepEqual(value.asset.bytes,png);
 assert.match(value.asset.sha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(parseOutgoingMessage('[CQ:image,file=base64://'+png.toString('base64')+']').asset.bytes,png);
 assert.equal(parseOutgoingMessage([{type:'text',data:{text:'A'}},{type:'text',data:{text:'😊'}}]).text,'A😊');
});
test('rejects unsafe or ambiguous images before upload',()=>{
 for(const value of [
  [{type:'image',data:{file:'https://example.invalid/sticker.png'}}],
  [{type:'image',data:{file:'file:///C:/secret.png'}}],
  [{type:'image',data:{file:'base64://@!'}}],
  [sample(),sample()],
  [{type:'text',data:{text:'hello'}},sample()],
  [{type:'image',data:{file:'base64://'+Buffer.from('malicious').toString('base64')}}],
  '[CQ:image,file=base64://abc] accidentally appended'
 ])assert.throws(()=>parseOutgoingMessage(value),/图片|表情|混合|支持/);
 const gif=Buffer.concat([Buffer.from('GIF89a'),Buffer.alloc(8)]);
 assert.equal(decodeImageSegment({type:'image',data:{file:'base64://'+gif.toString('base64')}}).extension,'gif');
 const webp=Buffer.concat([Buffer.from('RIFF'),Buffer.from([20,0,0,0]),Buffer.from('WEBP'),Buffer.alloc(8)]);
 assert.equal(decodeImageSegment({type:'image',data:{file:'base64://'+webp.toString('base64')}}).extension,'webp');
});
test('incoming Douyin sticker is forwarded as a labeled message and verified image',()=>{
 const m={id:msg('a'),text:'',media:{type:'emoji',label:'[大笑]',resources:[{resourceRef:'media:'+'1'.repeat(64)}]}};
 assert.match(stickerLabel(m),/抖音表情包/);
 assert.notDeepEqual(incomingFingerprintParts(m),incomingFingerprintParts({...m,media:{...m.media,label:'[震惊]'}}));
 const frame={messageId:m.id,media:{type:'emoji'},frames:[{mimeType:'image/jpeg',data:jpeg.toString('base64')}]};
 assert.equal(extractStickerFrame(frame,m.id),jpeg.toString('base64'));
 assert.equal(extractStickerFrame({...frame,messageId:msg('b')},m.id),null);
 assert.equal(extractStickerFrame({...frame,media:{type:'shared-work'}},m.id),null);
 assert.equal(extractStickerFrame({...frame,frames:[{mimeType:'image/png',data:jpeg.toString('base64')}]},m.id),null);
});

test('send_private_msg and send_group_msg use upstream image upload with exact authorize gate',async()=>{
 for(const isGroup of [false,true]){
  const f=fixture(),c=contact(conv(isGroup?'b':'a'),isGroup);
  try{
   f.allowlist.upsertContacts([c]);f.allowlist.setEnabled(c.id,true);
   f.allowlist.setStickerEnabled(c.id,true);
   let calls=0;
   const driver={
     listContacts:async()=>({contacts:[c]}),
     readConversation:async()=>({messages:[{id:msg('0')}]}),
     sendImageMessage:async(id,asset,options)=>{
       calls++;assert.equal(id,c.id);assert.deepEqual(asset.bytes,png);
       assert.deepEqual(options.expectedMessageIds,[msg('0')]);
       assert.equal(options.expectedContact.identityBinding,c.identityBinding);
       assert.equal(options.expectedContact.authorizationKind,'manual');
       assert.equal(await options.authorize({phase:'before-click'}),true);
       const release=options.authorize.beginDispatch();assert.equal(typeof release,'function');release();
       return {confirmed:true,deliveryUncertain:false,messageId:msg('8')};
     }
   };
   const g=new Gateway({driver,store:{id:()=>24,lookup:()=>c.id},allowlist:f.allowlist,client:{},
     config:{enableSending:true,enableImageSending:true}});
   await g.refresh();
   const action=isGroup?'send_group_msg':'send_private_msg';
   const result=await g.actions(action,{[isGroup?'group_id':'user_id']:24,message:[sample()]});
   assert.equal(result.message_id,24);
   assert.equal(calls,1);
   f.allowlist.setStickerEnabled(c.id,false);
   await assert.rejects(()=>g.actions(action,{[isGroup?'group_id':'user_id']:24,message:[sample()]}),/disabled/);
   assert.equal(calls,1);
  }finally{f.close();}
 }
});
test('global image gate and uncertain receipt never report success',async()=>{
 const f=fixture(),c=contact(conv('c'),false);
 try{
  f.allowlist.upsertContacts([c]);f.allowlist.setEnabled(c.id,true);f.allowlist.setStickerEnabled(c.id,true);
  let calls=0;
  const driver={listContacts:async()=>({contacts:[c]}),readConversation:async()=>({messages:[{id:msg('1')}]}),
    sendImageMessage:async(_id,_asset,{authorize})=>{calls++;
      f.allowlist.setStickerEnabled(c.id,false);
      assert.equal(await authorize({phase:'before-click'}),false);
      assert.throws(()=>authorize.beginDispatch());
      return {confirmed:false,deliveryUncertain:true};
    }};
  const cfg={enableSending:true,enableImageSending:false};
  const g=new Gateway({driver,store:{id:()=>7,lookup:()=>c.id},allowlist:f.allowlist,client:{},config:cfg});
  await g.refresh();
  await assert.rejects(()=>g.send('private',7,[sample()]),/disabled/);
  assert.equal(calls,0);
  cfg.enableImageSending=true;
  await assert.rejects(()=>g.send('private',7,[sample()]),/delivery uncertain/);
  assert.equal(calls,1);
 }finally{f.close();}
});
test('inbound emoji cards still reach AstrBot when no text is present',async()=>{
 const f=fixture(),c=contact(conv('d'),false);
 let rows=[{id:msg('a'),sender:'incoming',text:'hi',latestEndVerified:true}],captures=0;
 const forwarded=[];
 try{
  f.allowlist.upsertContacts([c]);f.allowlist.setEnabled(c.id,true);
  const driver={listContacts:async()=>({contacts:[c]}),readConversation:async()=>({messages:rows}),
    captureMessage:async(_id,id)=>{captures++;return {messageId:id,media:{type:'emoji'},
       frames:[{mimeType:'image/jpeg',data:jpeg.toString('base64')}]};}};
  const g=new Gateway({driver,allowlist:f.allowlist,store:{id:()=>100},client:{event:x=>forwarded.push(x)},
    config:{pollMs:2000,enableSending:false,receiveStickers:true}});
  await g.pollOnce();
  rows=[...rows,{id:msg('b'),sender:'incoming',text:'',kind:'emoji',latestEndVerified:true,media:{type:'emoji',label:'[点赞]'}}];
  await g.pollOnce();
  assert.equal(captures,1);assert.equal(forwarded.length,1);
  assert.match(forwarded[0].raw_message,/抖音表情包/);
  assert.deepEqual(forwarded[0].message.map(x=>x.type),['text','image']);
 }finally{f.close();}
});

test('multi-megabyte GIF and large incoming frames do not overflow validation',()=>{
 const bytes=randomBytes(4*1024*1024);Buffer.from('GIF89a').copy(bytes);
 const data=bytes.toString('base64');
 assert.deepEqual(decodeImageSegment({type:'image',data:{file:'base64://'+data}}).bytes,bytes);
 for(const malformed of [data+'=',data.slice(1),data.slice(0,-1)+'!',data.slice(0,8)+'='+data.slice(9)]){
  assert.throws(()=>decodeImageSegment({type:'image',data:{file:'base64://'+malformed}}),/格式|大小|规范/);
 }
 const largeJpeg=Buffer.alloc(400000);jpeg.copy(largeJpeg);
 const frame={messageId:msg('a'),media:{type:'emoji'},frames:[{mimeType:'image/jpeg',data:largeJpeg.toString('base64')}]};
 assert.equal(extractStickerFrame(frame,msg('a')),frame.frames[0].data);
});