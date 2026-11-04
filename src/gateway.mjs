import {createHash} from 'node:crypto';
import {messageEvent,textSegments} from './onebot-format.mjs';
import {validatedContact} from './douyin-driver.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const digest=x=>createHash('sha256').update(String(x)).digest('hex');
export class Gateway {
  constructor({driver,store,client,config,selfId=990000001,logger=console}) {
    Object.assign(this,{driver,store,client,config,selfId,logger});
    this.baselines=new Map();this.contacts=new Map();this.running=false;this.busy=false;
  }
  async refresh(){
    const rows=await this.driver.listContacts();
    const items=Array.isArray(rows)?rows:rows?.contacts??[];
    for(const c of items){
      if(validatedContact(c)&&this.config.allowlist.has(c.id)){
        this.contacts.set(c.id,c);
        this.store.id(c.isGroup?'group':'private',c.id);
      }
    }
  }
  async pollOnce(){
    await this.refresh();
    for(const c of this.contacts.values()){
      const snap=await this.driver.readConversation(c.id,{allowed:true});
      const rows=snap?.messages??snap?.snapshot?.messages??[];
      if(!Array.isArray(rows))continue;
      const signature=rows.filter(m=>m?.id&&m.sender==='incoming').map(m=>({
        m,k:`${c.id}:${m.id}:${digest(JSON.stringify([m.text??'',m.kind??'',m.memberId??'']))}`
      }));
      const last=this.baselines.get(c.id);const current=new Set(signature.map(x=>x.k));
      if(last){
        for(const {m,k} of signature){
          if(last.has(k))continue;
          if(!m.latestEndVerified || !m.id || (c.isGroup&&!/^member:[a-f0-9]{64}$/.test(m.memberId??'')))continue;
          const nativeSender=c.isGroup?m.memberId:c.id;
          const senderId=this.store.id(c.isGroup?'user':'private',nativeSender);
          const conversationId=this.store.id(c.isGroup?'group':'private',c.id);
          const msgId=this.store.id('message',k);
          this.client.event(messageEvent({selfId:this.selfId,messageId:msgId,conversationId,senderId,
            senderName:m.member??m.memberName??c.name,group:c.isGroup,content:String(m.text??''),
            mentionedSelf:m.mentionedSelf===true}));
        }
      }
      this.baselines.set(c.id,current);
    }
  }
  async loop(){
    this.running=true;
    while(this.running){
      try{await this.pollOnce();}catch(e){this.logger.error('[poll]',e.message);}
      await sleep(this.config.pollMs);
    }
  }
  async actions(action,params){
    switch(action){
      case 'get_login_info':return {user_id:this.selfId,nickname:'DouyinLuma'};
      case 'get_status':return {online:this.running,good:this.running};
      case 'can_send_image':return {yes:false};
      case 'can_send_record':return {yes:false};
      case 'get_group_list':return [...this.contacts.values()].filter(c=>c.isGroup).map(c=>({group_id:this.store.id('group',c.id),group_name:c.name??c.displayName??'抖音群',member_count:0,max_member_count:0}));
      case 'get_friend_list':return [...this.contacts.values()].filter(c=>!c.isGroup).map(c=>({user_id:this.store.id('user',c.id),nickname:c.name??c.displayName??'抖音好友',remark:''}));
      case 'send_group_msg':return this.send('group',params.group_id,params.message);
      case 'send_private_msg':return this.send('private',params.user_id,params.message);
      default:throw Object.assign(Error(`unsupported action: ${action}`),{retcode:1404});
    }
  }
  async send(kind,id,message){
    if(!this.config.enableSending)throw Object.assign(Error('sending disabled by ENABLE_SENDING'),{retcode:1403});
    const native=this.store.lookup(kind,id);const contact=this.contacts.get(native);
    if(!contact||Boolean(contact.isGroup)!==(kind==='group'))throw Object.assign(Error('unknown or unauthorized recipient'),{retcode:1404});
    const text=textSegments(message).trim();
    if(!text||[...text].length>1000)throw Object.assign(Error('text length must be 1-1000'),{retcode:1400});
    if(this.busy)throw Object.assign(Error('send queue busy, not retried'),{retcode:1409});
    this.busy=true;
    try {
      const snap=await this.driver.readConversation(native,{allowed:true});
      const rows=snap?.messages??[];
      const result=await this.driver.sendMessage(native,text,{allowed:true,expectedContact:contact,expectedMessageIds:rows.map(x=>x.id)});
      if(result?.confirmed!==true)throw Object.assign(Error(result?.deliveryUncertain?'delivery uncertain; do not retry automatically':'delivery not confirmed'),{retcode:result?.deliveryUncertain?1502:1501});
      const external=result.messageId??`confirmed:${Date.now()}:${native}`;
      return {message_id:this.store.id('sent-message',String(external))};
    } finally {this.busy=false;}
  }
}
