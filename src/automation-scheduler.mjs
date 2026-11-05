import {slotDue} from './automation-store.mjs';
const bad=(message,statusCode=409)=>Object.assign(Error(message),{statusCode});
export class AutomationScheduler {
  constructor({store,allowlist,driver,gateway,config,now=Date.now,logger=console,
    clockIntervalMs=30000}){
    Object.assign(this,{store,allowlist,driver,gateway,config,now,logger,clockIntervalMs});
    this.closed=false;this.current=null;this.timer=null;this.running=false;
  }
  state(){
    return {running:Boolean(this.current),closed:this.closed,
      browsingGloballyEnabled:this.config.enableAutoBrowsing===true,
      sharingGloballyEnabled:this.config.enableAutoSharing===true&&this.config.enableSending===true,
      timeZone:'Asia/Shanghai',plans:this.store.plans(),slots:this.store.slots(),
      deliveries:this.store.deliveries()};
  }
  start(){
    if(this.timer||this.closed)return this;
    this.timer=setInterval(()=>void this.tick(),this.clockIntervalMs);
    this.timer.unref?.();void this.tick();
    return this;
  }
  async stop(){
    this.closed=true;clearInterval(this.timer);this.timer=null;
    this.current?.controller.abort(Error('automation scheduler stopping'));
    await this.current?.promise?.catch(()=>{});
  }
  cancelPlan(id){
    if(this.current?.planId===id)this.current.controller.abort(Error('plan settings changed'));
  }
  async exclusive(planId,phase,fn){
    if(this.closed)throw bad('automation scheduler stopped');
    if(this.current)throw bad('another automated task is already running');
    const controller=new AbortController();
    const promise=Promise.resolve().then(()=>fn(controller.signal));
    this.current={planId,phase,controller,promise};
    try{return await promise;}
    finally{if(this.current?.promise===promise)this.current=null;}
  }
  requirePlan(planId){
    const plan=this.store.plan(planId);
    if(!plan||!plan.enabled)throw bad('自动任务不存在或未启用');
    if(!this.allowlist.allowed(plan.conversationId,plan.kind))
      throw bad('自动任务目标会话没有白名单授权');
    return plan;
  }
  async browseNow(id){
    if(this.config.enableAutoBrowsing!==true)throw bad('ENABLE_AUTO_BROWSING=false');
    const plan=this.requirePlan(id);
    return this.exclusive(id,'browse',signal=>this.browse(plan,signal));
  }
  async browse(plan,signal){
    if(!this.config.enableAutoBrowsing)throw bad('automatic browsing disabled');
    const joined=AbortSignal.any([signal,AbortSignal.timeout(120000)]);
    joined.throwIfAborted();
    const work=await this.driver.browseCandidates({
      topic:plan.topic,maxVideos:plan.browseCount,signal:joined});
    joined.throwIfAborted();
    if(!this.store.plan(plan.id)?.enabled)throw bad('plan disabled during browse');
    const inserted=this.store.addCandidates(plan.id,work,{source:'browse',now:this.now()});
    return {observed:work.length,added:inserted.added};
  }
  async share(plan,signal){
    if(!this.config.enableSending||!this.config.enableAutoSharing)
      throw bad('自动分享总开关未启用');
    if(typeof this.driver.forwardNativeVideo!=='function')
      throw bad('上游原生视频卡片分享器不可用');
    const queued=this.gateway.sendTail.then(async()=>{
      signal.throwIfAborted();
      const fresh=this.requirePlan(plan.id);
      const getContact=()=>{
        const c=this.gateway.contacts.get(fresh.conversationId);
        if(!c||Boolean(c.isGroup)!==(fresh.kind==='group')||
          !this.gateway.isAllowed(c)||!this.allowlist.autoShareAllowed(
            c.id,fresh.kind,c.identityBinding))return null;
        return c;
      };
      let contact=getContact();
      if(!contact){
        await this.gateway.refresh({force:true});
        contact=getContact();
      }
      if(!contact)throw bad('目标会话身份或自动分享权限尚未核实');
      const reserve=this.store.reserveDelivery(fresh,{now:this.now()});
      if(!reserve.ok)return {status:'skipped',reason:reserve.reason};
      const {deliveryId,candidate}=reserve;
      const authorized=()=>Boolean(!signal.aborted&&!this.closed&&
        this.config.enableSending&&this.config.enableAutoSharing&&
        this.store.plan(plan.id)?.enabled&&getContact()&&
        this.allowlist.autoShareAllowed(contact.id,fresh.kind,contact.identityBinding));
      let status='uncertain',reason='结果未确认',messageId=null;
      try{
        const result=await this.driver.forwardNativeVideo({contact,videoId:candidate.videoId,
          url:candidate.url,authorized,signal:AbortSignal.any([signal,AbortSignal.timeout(90000)])});
        if(result?.confirmed===true&&result.deliveryUncertain===false&&
          result.deliveryType==='native-card'&&result.videoId===candidate.videoId&&
          typeof result.messageId==='string'&&result.messageId){
          status='confirmed';messageId=result.messageId;reason='原生作品卡片回读成功';
        }else if(result?.confirmed===false&&result.deliveryUncertain===false&&
          result.status==='not-sent'&&result.preflight?.outcome==='not-sent'){
          status='not-sent';reason='发送前核实未发送';
        }else{reason='点击或发送回执不明确，必须人工核对，禁止自动重发';}
      }catch(error){
        // Only an explicit no-click preflight proof can qualify as not-sent.
        if(error?.preflight?.outcome==='not-sent'&&
          error.preflight.sendClicks===0&&error.preflight.dispatchAuthorized===false){
          status='not-sent';reason='上游确认发送前失败';
        }else{
          status='uncertain';reason='分享异常，不能确认是否已发送：'+String(error?.code??'unknown');
          this.logger.warn?.('[automation-share]',error?.message??String(error));
        }
      }
      this.store.finishDelivery(deliveryId,{status,messageId,note:reason});
      return {status,videoId:candidate.videoId,deliveryId,reason};
    });
    // This shares exactly the same serial outbound lane as AstrBot replies.
    this.gateway.sendTail=queued.catch(()=>{});
    return queued;
  }
  async shareScheduled(plan,signal){
    let sent=0,uncertain=false,skipped=null;
    for(let i=0;i<plan.shareCount;i++){
      signal.throwIfAborted();
      const r=await this.share(plan,signal);
      if(r.status==='confirmed')sent++;
      else if(r.status==='uncertain'){uncertain=true;break;}
      else if(r.status==='skipped'){skipped=r.reason;break;}
      // All unsuccessful attempts, even confirmed 'not-sent', are counted.
    }
    return {sent,uncertain,skipped};
  }
  async tick(){
    if(this.closed||this.running||this.current)return;
    this.running=true;
    try{
      for(const plan of this.store.plans().filter(x=>x.enabled)){
        if(this.closed||this.current)break;
        for(const phase of ['browse','share']){
          if(this.closed||this.current)break;
          if(phase==='browse'&&!this.config.enableAutoBrowsing)continue;
          if(phase==='share'&&(!this.config.enableAutoSharing||!this.config.enableSending))continue;
          const day=slotDue(plan,phase,this.now());
          if(!day||!this.store.claimSlot(plan.id,phase,day,{now:this.now()}))continue;
          try{
            const result=await this.exclusive(plan.id,phase,signal=>
              phase==='browse'?this.browse(plan,signal):this.shareScheduled(plan,signal));
            const status=result?.uncertain?'needs-review':
              result?.skipped?'skipped':'completed';
            this.store.finishSlot(plan.id,phase,day,status,JSON.stringify(result));
          }catch(e){
            this.logger.error?.('[automation]',phase,plan.id,e?.message??String(e));
            this.store.finishSlot(plan.id,phase,day,'failed',e?.message??String(e));
          }
        }
      }
    }finally{this.running=false;}
  }
}
