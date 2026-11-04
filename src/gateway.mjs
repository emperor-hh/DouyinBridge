import { createHash } from 'node:crypto';
import { messageEvent, textSegments } from './onebot-format.mjs';
import { validatedContact } from './douyin-driver.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const digest=x=>createHash('sha256').update(String(x)).digest('hex');
const disabled=()=>Object.assign(Error('conversation is no longer authorized'),{retcode:1403});

export class Gateway {
  constructor({driver,store,client,config,allowlist,selfId=990000001,logger=console}){
    Object.assign(this,{driver,store,client,config,allowlist,selfId,logger});
    this.baselines=new Map();this.contacts=new Map();
    this.running=false;this.busy=false;this.scanPromise=null;this.lastScan=null;this.lastScanError=null;
    this.nextScanAt=0;this.scanIntervalMs=60_000;
  }
  isScanning(){return Boolean(this.scanPromise);}
  authorizationChanged(id){
    // Previously queued/in-flight reads must not create an event after revoke.
    this.baselines.delete(id);
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
        m,k:`${c.id}:${m.id}:${digest(JSON.stringify([m.text??'',m.kind??'',m.memberId??'']))}`
      }));
      const previous=this.baselines.get(c.id),current=new Set(incoming.map(x=>x.k));
      if(previous){
        for(const {m,k} of incoming){
          if(!this.isAllowed(c))break;
          if(previous.has(k)||!m.latestEndVerified||!m.id||typeof m.text!=='string'||!m.text.trim())continue;
          if(c.isGroup&&!/^member:[a-f0-9]{64}$/.test(m.memberId??''))continue;
          const senderKey=c.isGroup?m.memberId:c.id;
          const senderId=this.store.id(c.isGroup?'user':'private',senderKey);
          const conversationId=this.store.id(c.isGroup?'group':'private',c.id);
          const msgId=this.store.id('message',k);
          if(!this.isAllowed(c))break;
          this.client.event(messageEvent({selfId:this.selfId,messageId:msgId,conversationId,
            senderId,senderName:typeof m.member==='string'?m.member:typeof m.memberName==='string'?m.memberName:c.name,
            group:c.isGroup,content:m.text,mentionedSelf:m.mentionedSelf===true}));
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
      case 'get_status':return {online:this.running,good:this.running};
      case 'can_send_image':return {yes:false};
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
    const text=textSegments(message).trim();
    if(!text||[...text].length>1000)throw Object.assign(Error('text length must be 1-1000'),{retcode:1400});
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
        authorizationKind:c.isGroup?'existing-group':c.followed===true?'following':'existing-conversation',
        verifiedAt:new Date().toISOString()};
      const result=await this.driver.sendMessage(native,text,{
        allowed:true,expectedContact,expectedMessageIds:rows.map(x=>x.id)
      });
      if(result?.confirmed!==true)throw Object.assign(
        Error(result?.deliveryUncertain?'delivery uncertain, do not retry':'delivery not confirmed'),
        {retcode:result?.deliveryUncertain?1502:1501});
      return {message_id:this.store.id('sent-message',String(result.messageId??`confirmed:${Date.now()}:${native}`))};
    }finally{this.busy=false;}
  }
}
