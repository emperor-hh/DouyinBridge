import { createHash } from 'node:crypto';
import { messageEvent, textSegments } from './onebot-format.mjs';
import { validatedContact } from './douyin-driver.mjs';
import { formatIncomingMessage, incomingFingerprintParts, extractCoverFrame, sharedWorkDetails } from './shared-work.mjs';
import { selectRequestedVideo, formatSampleEvidence } from './video-trigger.mjs';
import { validateSampleTarget } from './video-sampler.mjs';
import {parseOutgoingMessage,stickerLabel,extractStickerFrame} from './sticker.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const digest=x=>createHash('sha256').update(String(x)).digest('hex');
const disabled=()=>Object.assign(Error('conversation is no longer authorized'),{retcode:1403});

export class Gateway {
  constructor({driver,store,client,config,allowlist,selfId=990000001,logger=console}){
    Object.assign(this,{driver,store,client,config,allowlist,selfId,logger});
    this.baselines=new Map();this.contacts=new Map();
    this.running=false;this.busy=false;this.scanPromise=null;this.lastScan=null;this.lastScanError=null;
    this.nextScanAt=0;this.scanIntervalMs=60_000;this.videoAbort=new Map();this.lastStickerCapture=new Map();
  }
  isScanning(){return Boolean(this.scanPromise);}
  authorizationChanged(id){
    // Previously queued/in-flight reads must not create an event after revoke.
    this.baselines.delete(id);
    this.videoAbort.get(id)?.abort(Error('Video sampling authorization changed'));
    // Keep verified identity metadata for send-time re-check and UI, but
    // always consult the database for every event/action.
  }
  isAllowed(c){
    return Boolean(validatedContact(c) &&
      this.allowlist.allowed(c.id,c.isGroup?'group':'private',c.identityBinding));
  }
  async refresh({force=false}={}){
    if(this.scanPromise)return this.scanPromise;
    if(!force && Date.now()<this.nextScanAt)return {count:this.contacts.size};
    this.scanPromise=(async()=>{
      const raw=await this.driver.listContacts({verifyFollowing:false});
      if(raw?.blocked||raw?.loginRequired||raw?.verificationRequired){
        throw Error('抖音页面处于登录或验证状态，未更新联系人');
      }
      const items=Array.isArray(raw)?raw:raw?.contacts;
      if(!Array.isArray(items))throw Error('抖音会话列表不可用');
      const valid=items.filter(validatedContact);
      this.allowlist.upsertContacts(valid);
      const next=new Map();
      for(const c of valid) {
        // Ignore conflicting identity records. Do not silently keep them enabled.
        if(this.allowlist.allowed(c.id,c.isGroup?'group':'private',c.identityBinding) ||
          this.allowlist.lookup(c.id)?.identity_binding===c.identityBinding)
          next.set(c.id,c);
      }
      // Don't wipe an earlier healthy snapshot on partial discovery.
      for(const [id,c] of this.contacts)if(!next.has(id))next.set(id,c);
      this.contacts=next;
      this.lastScan=new Date().toISOString();this.lastScanError=null;
      this.nextScanAt=Date.now()+this.scanIntervalMs;
      return {count:valid.length,scannedToEnd:raw?.listDiscovery?.scannedToEnd===true,
        notes:raw?.listDiscovery?.reason??raw?.listDiscovery?.note??null};
    })();
    try{return await this.scanPromise;}
    catch(e){this.lastScanError=e.message;this.nextScanAt=Date.now()+10_000;throw e;}
    finally{this.scanPromise=null;}
  }
  async captureCoverIfAllowed(c,message){
    if(!sharedWorkDetails(message)||typeof this.driver.captureMessage!=='function')return null;
    if(c.isGroup&&message.mentionedSelf!==true)return null;
    if(!this.isAllowed(c)||!this.allowlist.coverAllowed?.(c.id,c.isGroup?'group':'private',c.identityBinding))return null;
    const nativeId=message.id;
    if(typeof nativeId!=='string'||!/^msg:[a-f0-9]{64}$/.test(nativeId))return null;
    try{
      const captured=await this.driver.captureMessage(c.id,nativeId,{allowed:true});
      // A whitelist or cover permission may have been revoked during screenshot.
      if(!this.isAllowed(c)||!this.allowlist.coverAllowed?.(c.id,c.isGroup?'group':'private',c.identityBinding))return null;
      return extractCoverFrame(captured,nativeId);
    }catch(error){
      this.logger.warn?.('[video-cover]',error?.message??String(error));
      return null;
    }
  }
  videoAllowed(c){
    return Boolean(this.isAllowed(c)&&
      this.allowlist.videoAllowed?.(c.id,c.isGroup?'group':'private',c.identityBinding));
  }
  async sampleIfRequested(c,request,rows){
    if(this.config.shareForwarding===false)return null;
    const selection=selectRequestedVideo(rows,rows.findIndex(m=>m.id===request.id),{group:c.isGroup});
    if(!selection)return null;
    const {card,work}=selection;
    const unavailable=()=>({summary:'[未提供视频采样画面] 当前权限、配额或视频页面无法满足采样要求；不能仅凭链接推测视频内容。',frames:[]});
    if(!this.videoAllowed(c)||typeof this.driver.sampleSharedVideo!=='function'||this.videoAbort.has(c.id))
      return unavailable();
    const sampleKey='sample:'+digest([c.id,request.id,card.id].join('|'));
    if(!this.allowlist.reserveVideoSample(c.id,sampleKey).ok)return unavailable();
    const abort=new AbortController(),signal=AbortSignal.any([abort.signal,AbortSignal.timeout(45_000)]);
    this.videoAbort.set(c.id,abort);
    const fingerprint=m=>digest(JSON.stringify(incomingFingerprintParts(m)));
    const requestFingerprint=fingerprint(request),cardFingerprint=fingerprint(card);
    try{
      signal.throwIfAborted();
      let videoId=work.videoId,url=work.url;
      if(!url){
        if(typeof this.driver.openSharedVideo!=='function')throw Error('分享作品没有可信链接');
        const opened=await this.driver.openSharedVideo(c.id,card.id,{allowed:true,signal});
        if(opened?.blocked||!opened?.videoId||!opened?.url||
           videoId&&opened.videoId!==videoId)throw Error('分享作品身份未核实');
        videoId=opened.videoId;url=opened.url;
      }
      validateSampleTarget({videoId,url,seconds:this.config.videoSampleSeconds??3});
      if(!this.videoAllowed(c))return null;
      const observation=await this.driver.sampleSharedVideo({
        videoId,url,seconds:this.config.videoSampleSeconds??3,signal});
      signal.throwIfAborted();
      if(!this.videoAllowed(c))return null;
      const after=await this.driver.readConversation(c.id,{allowed:true});
      if(!this.videoAllowed(c)||!Array.isArray(after?.messages))return null;
      const laterRequest=after.messages.find(m=>m.id===request.id);
      const laterCard=after.messages.find(m=>m.id===card.id);
      if(!laterRequest||!laterCard||fingerprint(laterRequest)!==requestFingerprint||
        fingerprint(laterCard)!==cardFingerprint)throw Error('采样期间会话消息已变化');
      if(observation?.videoId!==videoId||observation.url!==url)throw Error('作品 ID 与采样结果不匹配');
      const summary=formatSampleEvidence(observation);
      return {summary,frames:observation.frames.map(frame=>frame.data)};
    }catch(error){
      if(!this.videoAllowed(c)||signal.aborted)return null;
      this.logger.warn?.('[video-sampling]',error?.message??String(error));
      return unavailable();
    }finally{
      if(this.videoAbort.get(c.id)===abort)this.videoAbort.delete(c.id);
      abort.abort();
    }
  }
  async captureStickerIfAllowed(c,message){
    if(this.config.receiveStickers===false||message?.media?.type!=='emoji'||
      typeof this.driver.captureMessage!=='function'||!this.isAllowed(c))return null;
    if(typeof message.id!=='string'||!/^msg:[a-f0-9]{64}$/.test(message.id))return null;
    const now=Date.now(),previous=this.lastStickerCapture.get(c.id)??0;
    if(now-previous<10000)return null;
    this.lastStickerCapture.set(c.id,now);
    try{
      const captured=await this.driver.captureMessage(c.id,message.id,{allowed:true});
      if(!this.isAllowed(c))return null;
      return extractStickerFrame(captured,message.id);
    }catch(error){
      this.logger.warn?.('[sticker-receive]',error?.message??String(error));return null;
    }
  }
  async pollOnce(){
    await this.refresh();
    // Snapshot allowed contacts; check authorization again after awaits.
    for(const c of this.contacts.values()){
      if(!this.isAllowed(c)){this.baselines.delete(c.id);continue;}
      const snap=await this.driver.readConversation(c.id,{allowed:true});
      if(!this.isAllowed(c)){this.baselines.delete(c.id);continue;}
      if(snap?.blocked||snap?.loginRequired||snap?.verificationRequired)continue;
      const rows=snap?.messages??snap?.snapshot?.messages;
      if(!Array.isArray(rows))continue;
      const incoming=rows.filter(m=>m?.id&&m.sender==='incoming').map(m=>({
        m,k:`${c.id}:${m.id}:${digest(JSON.stringify(incomingFingerprintParts(m)))}`
      }));
      const previous=this.baselines.get(c.id),current=new Set(incoming.map(x=>x.k));
      if(previous){
        for(const {m,k} of incoming){
          if(!this.isAllowed(c))break;
          if(previous.has(k)||!m.latestEndVerified||!m.id)continue;
          const content=stickerLabel(m)??formatIncomingMessage(m,{includeSharedWork:this.config.shareForwarding!==false});
          if(!content)continue;
          if(c.isGroup&&!/^member:[a-f0-9]{64}$/.test(m.memberId??''))continue;
          const senderKey=c.isGroup?m.memberId:c.id;
          const senderId=this.store.id(c.isGroup?'user':'private',senderKey);
          const conversationId=this.store.id(c.isGroup?'group':'private',c.id);
          const msgId=this.store.id('message',k);
          const sampled=await this.sampleIfRequested(c,m,rows);
          if(!this.isAllowed(c))break;
          const coverBase64=sampled?.frames?.length?null:
            m.media?.type==='emoji'?await this.captureStickerIfAllowed(c,m):
            this.config.shareForwarding===false?null:await this.captureCoverIfAllowed(c,m);
          if(!this.isAllowed(c))break;
          this.client.event(messageEvent({selfId:this.selfId,messageId:msgId,conversationId,
            senderId,senderName:typeof m.member==='string'?m.member:typeof m.memberName==='string'?m.memberName:c.name,
            group:c.isGroup,content:sampled?content+'\n'+sampled.summary:content,
            mentionedSelf:m.mentionedSelf===true,imageBase64:coverBase64,imageFrames:sampled?.frames??[]}));
        }
      }
      if(this.isAllowed(c))this.baselines.set(c.id,current);
      else this.baselines.delete(c.id);
    }
  }
  async loop(){
    this.running=true;
    while(this.running){
      try{await this.pollOnce();}catch(e){this.logger.error('[poll]',e.message);}
      if(!this.running)break;
      await sleep(this.config.pollMs);
    }
  }
  async actions(action,params){
    switch(action){
      case 'get_login_info':return {user_id:this.selfId,nickname:'DouyinLuma'};
      case 'get_group_member_info':{
        const native=this.store.lookup('group',params.group_id),contact=this.contacts.get(native);
        if(!contact||!contact.isGroup||!this.isAllowed(contact))throw disabled();
        if(Number(params.user_id)!==this.selfId)
          throw Object.assign(Error('group member information unavailable'),{retcode:1404});
        return {group_id:Number(params.group_id),user_id:this.selfId,nickname:'DouyinLuma',
          card:'DouyinLuma',sex:'unknown',age:0,role:'member',title:'',card_changeable:false};
      }
      case 'get_status':return {online:this.running,good:this.running};
      case 'can_send_image':return {yes:this.config.enableSending&&this.config.enableImageSending===true};
      case 'can_send_record':return {yes:false};
      case 'get_group_list':return [...this.contacts.values()].filter(c=>c.isGroup&&this.isAllowed(c))
        .map(c=>({group_id:this.store.id('group',c.id),group_name:c.name??c.displayName??'抖音群',member_count:0,max_member_count:0}));
      case 'get_friend_list':return [...this.contacts.values()].filter(c=>!c.isGroup&&this.isAllowed(c))
        .map(c=>({user_id:this.store.id('private',c.id),nickname:c.name??c.displayName??'抖音好友',remark:''}));
      case 'send_group_msg':return this.send('group',params.group_id,params.message);
      case 'send_private_msg':return this.send('private',params.user_id,params.message);
      default:throw Object.assign(Error(`unsupported action: ${action}`),{retcode:1404});
    }
  }
  async send(kind,id,message){
    if(!this.config.enableSending)throw Object.assign(Error('sending disabled by ENABLE_SENDING'),{retcode:1403});
    const native=this.store.lookup(kind,id),c=native?this.contacts.get(native):null;
    if(!c||Boolean(c.isGroup)!==(kind==='group')||!this.isAllowed(c))throw disabled();
    const outgoing=parseOutgoingMessage(message);
    if(outgoing.type==='image'){
      if(this.config.enableImageSending!==true||
        !this.allowlist.stickerAllowed?.(c.id,kind,c.identityBinding))
        throw Object.assign(Error('image/sticker sending is disabled for this conversation'),{retcode:1403});
      if(typeof this.driver.sendImageMessage!=='function')
        throw Object.assign(Error('upstream image sending not available'),{retcode:1404});
    }
    const text=outgoing.type==='text'?outgoing.text.trim():'';
    if(outgoing.type==='text'&&(!text||[...text].length>1000))
      throw Object.assign(Error('text length must be 1-1000'),{retcode:1400});
    if(this.busy)throw Object.assign(Error('send queue busy; do not automatically retry'),{retcode:1409});
    this.busy=true;
    try{
      const snap=await this.driver.readConversation(native,{allowed:true});
      if(!this.isAllowed(c))throw disabled();
      if(snap?.blocked||snap?.loginRequired||snap?.verificationRequired)throw Error('webpage requires attention');
      const rows=snap?.messages;
      if(!Array.isArray(rows))throw Error('message watermark unavailable');
      // We check authorization immediately before dispatch. An in-progress UI
      // click cannot be retracted after it reaches the platform.
      if(!this.isAllowed(c))throw disabled();
      const expectedContact={...c,
        authorizationKind:'manual',
        verifiedAt:new Date().toISOString()};
      let result;
      if(outgoing.type==='image'){
        const authorized=()=>this.config.enableSending===true&&
          this.config.enableImageSending===true&&this.isAllowed(c)&&
          this.allowlist.stickerAllowed(c.id,kind,c.identityBinding);
        const authorize=async()=>authorized();
        authorize.beginDispatch=()=>{
          if(!authorized())throw disabled();
          return ()=>{};
        };
        if(!authorized())throw disabled();
        result=await this.driver.sendImageMessage(native,outgoing.asset,{
          allowed:true,expectedContact,expectedMessageIds:rows.map(x=>x.id),
          authorize,backgroundOnly:false
        });
      }else{
        result=await this.driver.sendMessage(native,text,{
          allowed:true,expectedContact,expectedMessageIds:rows.map(x=>x.id)
        });
      }
      if(result?.confirmed!==true)throw Object.assign(
        Error(result?.deliveryUncertain?'delivery uncertain, do not retry':'delivery not confirmed'),
        {retcode:result?.deliveryUncertain?1502:1501});
      return {message_id:this.store.id('sent-message',String(result.messageId??`confirmed:${Date.now()}:${native}`))};
    }finally{this.busy=false;}
  }
}
