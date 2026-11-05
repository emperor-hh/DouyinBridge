import { randomUUID } from 'node:crypto';
import { CONVERSATION_ID } from './allowlist-store.mjs';

const bad=(message,statusCode=400)=>Object.assign(Error(message),{statusCode});
const ID=/^\d{1,64}$/;
const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ZONE='Asia/Shanghai';
const clock=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',
  day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

export function shanghaiClock(at=Date.now()){
 const d=Object.fromEntries(clock.formatToParts(new Date(at))
   .filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return {day:`${d.year}-${d.month}-${d.day}`,minute:Number(d.hour)*60+Number(d.minute)};
}
export function slotDue(plan,phase,now=Date.now()){
 const key=phase==='browse'?'browseAt':phase==='share'?'shareAt':null;
 if(!key)throw bad('invalid automation phase');
 const configured=plan[key];
 if(!TIME.test(configured??''))return null;
 const time=shanghaiClock(now),[h,m]=configured.split(':').map(Number);
 const distance=time.minute-(h*60+m);
 return distance>=0&&distance<15?time.day:null;
}
export function canonicalVideo(value){
 if(typeof value!=='string'||value.length>300)throw bad('作品链接格式不正确');
 let url;try{url=new URL(value);}catch{throw bad('作品 URL 无效');}
 const id=/^\/video\/(\d{1,64})\/?$/.exec(url.pathname)?.[1];
 if(url.origin!=='https://www.douyin.com'||url.username||url.password||url.port||
   url.search||url.hash||!id)throw bad('仅接受 https://www.douyin.com/video/数字 公开作品链接');
 return {videoId:id,url:`https://www.douyin.com/video/${id}`};
}
function text(value,max){
 if(typeof value!=='string')throw bad('文本字段格式错误');
 const s=value.trim();
 if(s.length>max||/[\u0000-\u001f\u007f]/.test(s))throw bad('文本包含非法字符或过长');
 return s;
}
const planRow=r=>r&&({id:r.id,name:r.name,conversationId:r.conversation_id,
  kind:r.kind,browseAt:r.browse_at,shareAt:r.share_at,topic:r.topic,
  browseCount:r.browse_count,shareCount:r.share_count,enabled:r.enabled===1});
export function validatePlan(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw bad('plan must be object');
 if(Object.keys(input).some(x=>!['name','conversationId','browseAt','shareAt','topic','browseCount','shareCount'].includes(x)))
   throw bad('plan has unsupported fields');
 const name=text(input.name??'',80),topic=text(input.topic??'',80);
 if(!name)throw bad('plan name required');
 if(!CONVERSATION_ID.test(input.conversationId??''))throw bad('invalid conversation ID');
 if(!TIME.test(input.browseAt??'')||!TIME.test(input.shareAt??''))throw bad('时间需为 HH:MM');
 const browseCount=input.browseCount??5,shareCount=input.shareCount??1;
 if(!Number.isInteger(browseCount)||browseCount<1||browseCount>10)
   throw bad('每次浏览数量须为 1–10');
 if(!Number.isInteger(shareCount)||shareCount<1||shareCount>2)
   throw bad('每天每计划分享数须为 1–2');
 return {name,topic,conversationId:input.conversationId,browseAt:input.browseAt,
   shareAt:input.shareAt,browseCount,shareCount};
}

export class AutomationStore {
 constructor(allowlist){
   this.allowlist=allowlist;this.db=allowlist.db;
   this.db.exec(`
     CREATE TABLE IF NOT EXISTS auto_plans (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       conversation_id TEXT NOT NULL,
       kind TEXT NOT NULL CHECK(kind IN ('private','group')),
       browse_at TEXT NOT NULL,
       share_at TEXT NOT NULL,
       topic TEXT NOT NULL DEFAULT '',
       browse_count INTEGER NOT NULL,
       share_count INTEGER NOT NULL,
       enabled INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL
     );
     CREATE TABLE IF NOT EXISTS auto_candidates (
       id TEXT PRIMARY KEY,
       plan_id TEXT NOT NULL,
       video_id TEXT NOT NULL,
       url TEXT NOT NULL,
       title TEXT NOT NULL,
       author TEXT NOT NULL,
       source TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       UNIQUE(plan_id,video_id)
     );
     CREATE TABLE IF NOT EXISTS auto_slots (
       plan_id TEXT NOT NULL,
       phase TEXT NOT NULL CHECK(phase IN ('browse','share')),
       day TEXT NOT NULL,
       status TEXT NOT NULL,
       started_at INTEGER NOT NULL,
       finished_at INTEGER,
       note TEXT,
       PRIMARY KEY(plan_id,phase,day)
     );
     CREATE TABLE IF NOT EXISTS auto_deliveries (
       id TEXT PRIMARY KEY,
       plan_id TEXT NOT NULL,
       candidate_id TEXT NOT NULL,
       conversation_id TEXT NOT NULL,
       video_id TEXT NOT NULL,
       status TEXT NOT NULL,
       started_at INTEGER NOT NULL,
       finished_at INTEGER,
       message_id TEXT,
       note TEXT,
       reviewed_at INTEGER,
       UNIQUE(conversation_id,video_id)
     );
     CREATE INDEX IF NOT EXISTS idx_auto_delivery_recipient ON auto_deliveries(conversation_id,started_at);
     CREATE INDEX IF NOT EXISTS idx_auto_candidates_plan ON auto_candidates(plan_id,created_at);
   `);
 }
 plans(){return this.db.prepare('SELECT * FROM auto_plans ORDER BY created_at DESC').all().map(planRow);}
 plan(id){return planRow(this.db.prepare('SELECT * FROM auto_plans WHERE id=?').get(id));}
 createPlan(input){
   const p=validatePlan(input),contact=this.allowlist.lookup(p.conversationId);
   if(!contact||contact.enabled!==1)throw bad('请先授权该私聊或群聊',403);
   const id=randomUUID(),now=Date.now();
   this.db.prepare(`INSERT INTO auto_plans
     (id,name,conversation_id,kind,browse_at,share_at,topic,browse_count,share_count,enabled,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,0,?)`)
     .run(id,p.name,p.conversationId,contact.kind,p.browseAt,p.shareAt,p.topic,
       p.browseCount,p.shareCount,now);
   return this.plan(id);
 }
 setEnabled(id,enabled){
   if(typeof enabled!=='boolean')throw bad('enabled must be boolean');
   const plan=this.plan(id);
   if(!plan)throw bad('plan not found',404);
   if(enabled&&!this.allowlist.allowed(plan.conversationId,plan.kind))
     throw bad('目标会话白名单已关闭',403);
   this.db.prepare('UPDATE auto_plans SET enabled=? WHERE id=?').run(enabled?1:0,id);
   return this.plan(id);
 }
 candidates(id){
   if(!this.plan(id))throw bad('plan not found',404);
   return this.db.prepare(`SELECT c.id,c.plan_id AS planId,c.video_id AS videoId,c.url,
     c.title,c.author,c.source,c.created_at AS createdAt,
     d.status AS deliveryStatus FROM auto_candidates c
     LEFT JOIN auto_deliveries d ON d.candidate_id=c.id AND d.conversation_id=
       (SELECT conversation_id FROM auto_plans WHERE id=c.plan_id)
     WHERE c.plan_id=? ORDER BY c.created_at DESC LIMIT 100`).all(id);
 }
 addCandidates(planId,items,{source='browse',now=Date.now()}={}){
   if(!this.plan(planId))throw bad('plan not found',404);
   if(!['browse','manual'].includes(source)||!Array.isArray(items)||items.length>20)
     throw bad('invalid candidate list');
   const insert=this.db.prepare(`INSERT OR IGNORE INTO auto_candidates
     (id,plan_id,video_id,url,title,author,source,created_at) VALUES(?,?,?,?,?,?,?,?)`);
   let added=0;
   this.db.exec('BEGIN IMMEDIATE');
   try{
     for(const item of items){
       if(!item||typeof item!=='object')throw bad('invalid candidate');
       const work=canonicalVideo(item.url);
       if(item.videoId!==undefined&&item.videoId!==work.videoId)throw bad('video ID and URL mismatch');
       const title=text(item.title??'',220),author=text(item.author??'',120);
       added+=insert.run(randomUUID(),planId,work.videoId,work.url,title,author,source,now).changes;
     }
     this.db.exec('COMMIT');
   }catch(e){this.db.exec('ROLLBACK');throw e;}
   return {added,total:items.length};
 }
 claimSlot(planId,phase,day,{now=Date.now()}={}){
   if(!['browse','share'].includes(phase)||!/^\d{4}-\d{2}-\d{2}$/.test(day))
     throw bad('invalid slot');
   const result=this.db.prepare(`INSERT OR IGNORE INTO auto_slots
     (plan_id,phase,day,status,started_at) VALUES(?,?,?,'reserved',?)`)
     .run(planId,phase,day,now);
   return result.changes===1;
 }
 finishSlot(planId,phase,day,status,note=''){
   if(!['completed','failed','needs-review','skipped'].includes(status))
     throw bad('invalid slot status');
   this.db.prepare(`UPDATE auto_slots SET status=?,finished_at=?,note=?
     WHERE plan_id=? AND phase=? AND day=? AND status='reserved'`)
     .run(status,Date.now(),String(note).slice(0,200),planId,phase,day);
 }
 slots(limit=25){return this.db.prepare(`SELECT plan_id AS planId,phase,day,status,
   started_at AS startedAt,finished_at AS finishedAt,note FROM auto_slots
   ORDER BY started_at DESC LIMIT ?`).all(Math.min(100,limit));}
 deliveries(limit=50){return this.db.prepare(`SELECT id,plan_id AS planId,
   candidate_id AS candidateId,conversation_id AS conversationId,video_id AS videoId,
   status,started_at AS startedAt,finished_at AS finishedAt,message_id AS messageId,
   note,reviewed_at AS reviewedAt FROM auto_deliveries
   ORDER BY started_at DESC LIMIT ?`).all(Math.min(100,limit));}
 // Lock and reserve before any browser click. Pending/uncertain receipts permanently
 // block further sends to that recipient until explicitly reviewed.
 reserveDelivery(plan,{now=Date.now()}={}){
   this.db.exec('BEGIN IMMEDIATE');
   try{
     const reject=reason=>{this.db.exec('COMMIT');return {ok:false,reason};};
     if(!this.plan(plan.id)?.enabled)return reject('plan disabled');
     if(!this.allowlist.autoShareAllowed(plan.conversationId,plan.kind))
       return reject('conversation auto-sharing permission disabled');
     if(this.db.prepare(`SELECT 1 FROM auto_deliveries
       WHERE conversation_id=? AND status IN ('reserved','uncertain') LIMIT 1`)
       .get(plan.conversationId))return reject('recipient has unresolved deliveries');
     const since=now-86400000;
     const per=this.db.prepare(`SELECT COUNT(*) AS count,MAX(started_at) AS lastAt
       FROM auto_deliveries WHERE conversation_id=? AND started_at>=?`)
       .get(plan.conversationId,since);
     const global=this.db.prepare('SELECT COUNT(*) AS count FROM auto_deliveries WHERE started_at>=?')
       .get(since).count;
     if(per.count>=2||global>=12||per.lastAt!==null&&now-per.lastAt<30*60*1000)
       return reject('recipient cooldown or global daily sharing cap');
     const candidate=this.db.prepare(`SELECT c.* FROM auto_candidates c
       WHERE c.plan_id=? AND NOT EXISTS
       (SELECT 1 FROM auto_deliveries d WHERE d.conversation_id=? AND d.video_id=c.video_id)
       ORDER BY c.created_at ASC LIMIT 1`).get(plan.id,plan.conversationId);
     if(!candidate)return reject('no eligible candidates');
     const id=randomUUID();
     this.db.prepare(`INSERT INTO auto_deliveries
       (id,plan_id,candidate_id,conversation_id,video_id,status,started_at)
       VALUES(?,?,?,?,?,'reserved',?)`)
       .run(id,plan.id,candidate.id,plan.conversationId,candidate.video_id,now);
     this.db.exec('COMMIT');
     return {ok:true,deliveryId:id,candidate:{videoId:candidate.video_id,url:candidate.url,
       title:candidate.title,author:candidate.author}};
   }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 finishDelivery(id,{status,messageId=null,note=''}){
   if(!['confirmed','not-sent','uncertain'].includes(status))throw bad('invalid receipt status');
   this.db.prepare(`UPDATE auto_deliveries SET status=?,finished_at=?,message_id=?,note=?
     WHERE id=? AND status='reserved'`).run(status,Date.now(),messageId,String(note).slice(0,200),id);
 }
 resolveDelivery(id,outcome){
   if(!['confirmed','not-sent'].includes(outcome))throw bad('invalid review outcome');
   const status=outcome==='confirmed'?'resolved-confirmed':'resolved-not-sent';
   const result=this.db.prepare(`UPDATE auto_deliveries SET status=?,reviewed_at=?
     WHERE id=? AND status IN ('uncertain','reserved')`).run(status,Date.now(),id);
   if(result.changes!==1)throw bad('unresolved delivery not found',404);
   return this.deliveries().find(x=>x.id===id)??{id,status};
 }
}
