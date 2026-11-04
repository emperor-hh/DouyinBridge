import {createHash} from 'node:crypto';

// OneBot image segments become *image uploads* in Douyin. Native Douyin
// sticker-library selections are NOT implemented by the upstream client.
const MAX_BYTES=8*1024*1024;
const invalid=(message)=>Object.assign(Error(message),{retcode:1400});
const isText=x=>x?.type==='text'&&typeof x?.data?.text==='string';
function imageType(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<12||bytes.length>MAX_BYTES)
    throw invalid('表情图片大小必须在 12 字节到 8MB 之间');
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    return {extension:'png',mimeType:'image/png'};
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)
    return {extension:'jpg',mimeType:'image/jpeg'};
  if(/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()))
    return {extension:'gif',mimeType:'image/gif'};
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')
    return {extension:'webp',mimeType:'image/webp'};
  throw invalid('仅支持 PNG、JPEG、GIF、WebP 表情图片');
}
export function decodeImageSegment(segment){
  if(segment?.type!=='image'||typeof segment?.data?.file!=='string')
    throw invalid('仅支持 OneBot image 段');
  const raw=segment.data.file;
  if(!raw.startsWith('base64://'))
    throw invalid('发送表情包目前仅支持 base64:// 图片；不读取本地路径或远程 URL');
  const data=raw.slice(9);
  if(data.length<16||data.length>Math.ceil(MAX_BYTES*4/3)+4||
     (data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(data)))
    throw invalid('图片的 base64 数据格式或大小无效');
  const bytes=Buffer.from(data,'base64');
  const kind=imageType(bytes);
  if(bytes.toString('base64')!==data)
    throw invalid('图片 base64 存在不规范编码');
  return {bytes,sha256:createHash('sha256').update(bytes).digest('hex'),...kind};
}
export function parseOutgoingMessage(message){
  if(typeof message==='string'){
    // Pure CQ image strings are accepted for OneBot string message_format.
    const match=/^\[CQ:image,file=(base64:\/\/[A-Za-z0-9+/]+=*)\]$/.exec(message.trim());
    if(match)return {type:'image',asset:decodeImageSegment({type:'image',data:{file:match[1]}})};
    if(message.includes('[CQ:image'))throw invalid('混合文本及 CQ 图片未支持，请仅发送单个图片段');
    return {type:'text',text:message};
  }
  if(!Array.isArray(message)||message.length<1)throw invalid('消息格式不支持');
  if(message.every(isText))return {type:'text',text:message.map(x=>x.data.text).join('')};
  const nonWhitespace=message.filter(x=>!(isText(x)&&x.data.text.trim()===''));
  if(nonWhitespace.length===1&&nonWhitespace[0]?.type==='image')
    return {type:'image',asset:decodeImageSegment(nonWhitespace[0])};
  throw invalid('发送表情包一次只支持一张图片，不能混合其他文字或图片段');
}
const clean=(x,max=160)=>typeof x==='string'?x.replace(/[\u0000-\u001f\u007f]/g,' ')
  .replace(/\s+/g,' ').replace(/\[CQ:/gi,'［CQ:').trim().slice(0,max):'';
export function stickerLabel(message){
  if(message?.media?.type!=='emoji'||message?.unsupported===true||message?.nonReplyableNotice===true)return null;
  const label=clean(message.media.label||message.media.resources?.[0]?.label||message.text);
  return label?`[抖音表情包] ${label}\n内容范围：表情卡片，具体表情以附带图片为准。`
    :'[抖音表情包] 内容范围：表情卡片，具体表情以附带图片为准。';
}
export function extractStickerFrame(captured,messageId,{maxBytes=512000}={}){
  if(captured?.messageId!==messageId||captured?.media?.type!=='emoji'||
     captured?.blocked||captured?.loginRequired||captured?.verificationRequired||
     !Array.isArray(captured.frames)||captured.frames.length!==1)return null;
  const frame=captured.frames[0];
  if(!['image/jpeg','image/png'].includes(frame?.mimeType)||typeof frame.data!=='string'||
    frame.data.length<16||frame.data.length>Math.ceil(maxBytes*4/3)+4||
    (frame.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(frame.data)))
    return null;
  const bytes=Buffer.from(frame.data,'base64');
  if(bytes.length<12||bytes.length>maxBytes||bytes.toString('base64')!==frame.data)return null;
  try{const type=imageType(bytes);if(type.mimeType!==frame.mimeType)return null;}catch{return null;}
  return frame.data;
}
