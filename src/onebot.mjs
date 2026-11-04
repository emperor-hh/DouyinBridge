import WebSocket from 'ws';
export class OneBotClient {
  constructor({url,token,selfId,actions,onState}) {
    Object.assign(this,{url,token,selfId,actions,onState});
    this.ws=null;this.closed=false;this.retry=1000;
  }
  connect(){
    if(this.closed)return;
    const headers={'X-Self-ID':String(this.selfId),'X-Client-Role':'Universal',...(this.token?{Authorization:`Bearer ${this.token}`}:{})};
    const ws=new WebSocket(this.url,{headers});this.ws=ws;
    ws.on('open',()=>{
      this.retry=1000;this.onState?.('connected');
      this.event({post_type:'meta_event',meta_event_type:'lifecycle',sub_type:'connect'});
    });
    ws.on('message',async raw=>{
      let req;
      try{
        req=JSON.parse(String(raw));
        if(!req||typeof req.action!=='string')return;
        const result=await this.actions(req.action,req.params??{});
        this.send({status:'ok',retcode:0,data:result??null,echo:req.echo});
      }catch(e){
        this.send({status:'failed',retcode:e.retcode??1400,data:null,message:e.message??'operation failed',echo:req?.echo});
      }
    });
    ws.on('close',()=>{this.onState?.('disconnected');this.schedule();});
    ws.on('error',e=>this.onState?.(`socket_error:${e.message}`));
  }
  schedule(){
    if(this.closed)return;
    const t=setTimeout(()=>this.connect(),this.retry);t.unref?.();this.retry=Math.min(this.retry*2,30000);
  }
  send(data){
    // Never queue messages over a disconnected transport: previously
    // authorized chat events could be delivered after a whitelist revocation.
    if(this.ws?.readyState!==WebSocket.OPEN)return false;
    this.ws.send(JSON.stringify(data));return true;
  }
  event(data){
    return this.send({time:Math.floor(Date.now()/1000),self_id:this.selfId,...data});
  }
  close(){this.closed=true;this.ws?.close();}
}
export {textSegments,messageEvent} from './onebot-format.mjs';
