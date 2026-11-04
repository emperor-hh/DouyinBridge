// Read-only conversion of an upstream dsh-douyin-agent "shared-work" card.
// A card is NOT proof that the video has been watched or heard.
const VIDEO_ID = /^\d{1,64}$/;
const MESSAGE_ID = /^msg:[a-f0-9]{64}$/;
const cleanText = (value,max=180) => typeof value==='string'
  ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/\s+/g,' ').replace(/\[CQ:/gi,'［CQ:').trim().slice(0,max)
  : '';

export function verifiedWorkLink(media) {
  if(media?.type!=='shared-work'||media.identityConflict===true)return null;
  if(typeof media.videoId!=='string'||!VIDEO_ID.test(media.videoId))return null;
  if(typeof media.url!=='string'||media.url.length>300)return null;
  try{
    const url=new URL(media.url);
    if(url.protocol!=='https:'||url.hostname!=='www.douyin.com'||url.username||url.password||
      url.port||url.search||url.hash||!new RegExp('^/video/('+media.videoId+')/?$').test(url.pathname))
      return null;
    return 'https://www.douyin.com/video/'+media.videoId;
  }catch{return null;}
}

export function sharedWorkDetails(message) {
  const media=message?.media;
  if(media?.type!=='shared-work'||message?.unsupported===true)return null;
  return {
    type:media.isPhotoGallery===true?'photo':'video',
    title:cleanText(media.title,220),
    author:cleanText(media.author,120),
    videoId:typeof media.videoId==='string'&&VIDEO_ID.test(media.videoId)&&media.identityConflict!==true
      ? media.videoId:null,
    url:verifiedWorkLink(media),
    identityConflict:media.identityConflict===true,
    messageId:typeof message.id==='string'&&MESSAGE_ID.test(message.id)?message.id:null
  };
}

export function formatIncomingMessage(message,{includeSharedWork=true}={}){
  if(!message||message.unsupported===true||message.nonReplyableNotice===true)return '';
  const normal=cleanText(message.text,6000);
  const card=includeSharedWork?sharedWorkDetails(message):null;
  if(!card)return normal;
  const lines=[card.type==='photo'?'[抖音分享图文]':'[抖音分享视频]'];
  if(card.title)lines.push('标题：'+card.title);
  if(card.author)lines.push('作者：'+card.author);
  if(card.videoId)lines.push('作品ID：'+card.videoId);
  if(card.url)lines.push('作品链接：'+card.url);
  else lines.push(card.identityConflict?'作品链接：身份冲突，未采信':'作品链接：未核实');
  lines.push(card.type==='photo'
    ? '内容范围：仅已显示的图文卡片元数据，未逐页读取图文。'
    : '内容范围：仅已显示的分享卡片元数据，未观看视频或收听音频。');
  return (normal?normal+'\n':'')+lines.join('\n');
}

export function incomingFingerprintParts(message) {
  const media=message?.media;
  const shared=media?.type==='shared-work'?[
    'shared-work',media.videoId??null,media.url??null,media.title??null,
    media.author??null,media.isPhotoGallery===true,media.identityConflict===true
  ]:null;
  const emoji=media?.type==='emoji'?['emoji',media.label??null,media.resources?.map(r=>r.resourceRef??null)??null]:null;
  return [message?.text??'',message?.kind??'',message?.memberId??'',shared,emoji];
}

export function extractCoverFrame(captured,messageId,{maxBytes=512_000}={}){
  if(!MESSAGE_ID.test(messageId)||captured?.messageId!==messageId||
     captured?.blocked||captured?.loginRequired||captured?.verificationRequired)return null;
  if(captured?.media?.type!=='shared-work'||captured.media.identityConflict===true)return null;
  const frames=captured.frames;
  if(!Array.isArray(frames)||frames.length<1)return null;
  const frame=frames[0];
  if(frame?.mimeType!=='image/jpeg'||typeof frame.data!=='string'||
    frame.data.length<8||frame.data.length>Math.ceil(maxBytes*4/3)+4||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(frame.data))return null;
  const bytes=Buffer.from(frame.data,'base64');
  if(bytes.length<4||bytes.length>maxBytes||
    bytes[0]!==0xff||bytes[1]!==0xd8||bytes.at(-2)!==0xff||bytes.at(-1)!==0xd9)return null;
  return frame.data;
}
