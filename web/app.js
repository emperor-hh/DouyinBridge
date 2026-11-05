'use strict';
const $=id=>document.getElementById(id);
const ADMIN_TOKEN_KEY='douyinbridge-admin';
const LEGACY_ADMIN_TOKEN_KEY='douyinluma-admin';
let token=sessionStorage.getItem(ADMIN_TOKEN_KEY)??sessionStorage.getItem(LEGACY_ADMIN_TOKEN_KEY)??'';
let contacts=[];
let automationData=null;
$('token').value=token;
const note=(msg,bad=false)=>{$('notice').textContent=msg;$('notice').style.color=bad?'#b42318':'#355e4d';};
async function call(url,opts={}){
 const res=await fetch(url,{...opts,headers:{Authorization:'Bearer '+token,...(opts.body?{'Content-Type':'application/json'}:{}),...opts.headers}});
 let data;try{data=await res.json();}catch{throw Error('服务返回无效响应');}
 if(!res.ok)throw Error(data.error??'HTTP '+res.status);
 return data;
}
function draw(){
 const tbody=$('rows');tbody.replaceChildren();
 const q=$('search').value.toLocaleLowerCase();const filter=$('filter').value;
 const items=contacts.filter(x=>(filter==='all'||x.kind===filter)&&(x.name.toLocaleLowerCase().includes(q)||x.id.includes(q)));
 for(const c of items){
   const tr=document.createElement('tr');
   const name=document.createElement('td');name.textContent=c.name;
   const kind=document.createElement('td');kind.textContent=c.kind==='group'?'群聊':'私聊';
   const id=document.createElement('td');const code=document.createElement('code');code.textContent=c.id;id.append(code);
   const cell=document.createElement('td');const check=document.createElement('input');check.type='checkbox';check.checked=c.enabled;check.setAttribute('aria-label','允许 '+c.name);
   check.addEventListener('change',async()=>{
     const enabled=check.checked;check.disabled=true;
     try{
       const r=await call('/api/conversations/'+encodeURIComponent(c.id),{method:'PUT',body:JSON.stringify({enabled})});
       c.enabled=r.item.enabled;note((c.enabled?'已授权：':'已取消授权：')+c.name);
     }catch(e){check.checked=!enabled;note(e.message,true);}finally{check.disabled=false;}
   });cell.append(check);
   const coverCell=document.createElement('td');const cover=document.createElement('input');
   cover.type='checkbox';cover.checked=c.coverEnabled;cover.setAttribute('aria-label','截取封面 '+c.name);
   cover.title='仅截取分享卡片封面，无音视频播放；群聊需要 @机器人';
   cover.addEventListener('change',async()=>{
     const enabled=cover.checked;cover.disabled=true;
     try{
       const r=await call('/api/conversations/'+encodeURIComponent(c.id)+'/cover',
         {method:'PUT',body:JSON.stringify({enabled})});
       c.coverEnabled=r.item.coverEnabled;
       note((c.coverEnabled?'已允许封面预览：':'已关闭封面预览：')+c.name);
     }catch(e){cover.checked=!enabled;note(e.message,true);}
     finally{cover.disabled=false;}
   });
   coverCell.append(cover);
   const videoCell=document.createElement('td'),video=document.createElement('input');
   video.type='checkbox';video.checked=c.videoEnabled;
   video.setAttribute('aria-label','允许按需视频分时采样 '+c.name);
   video.title='仅响应明确的视频分析请求；私聊无需@，群聊必须@机器人。只采集约3秒画面，无音轨';
   video.addEventListener('change',async()=>{
     const enabled=video.checked;video.disabled=true;
     try{
       const r=await call('/api/conversations/'+encodeURIComponent(c.id)+'/video',
         {method:'PUT',body:JSON.stringify({enabled})});
       c.videoEnabled=r.item.videoEnabled;
       note((c.videoEnabled?'已允许按需视频采样：':'已禁止按需视频采样：')+c.name);
     }catch(e){video.checked=!enabled;note(e.message,true);}
     finally{video.disabled=false;}
   });
   videoCell.append(video);
   const stickerCell=document.createElement('td'),sticker=document.createElement('input');
   sticker.type='checkbox';sticker.checked=c.stickerEnabled;
   sticker.setAttribute('aria-label','允许发送表情图片 '+c.name);
   sticker.title='允许 AstrBot 在此会话发送 PNG/JPEG/GIF/WebP 图片表情（还需全局发送开关）';
   sticker.addEventListener('change',async()=>{
     const enabled=sticker.checked;sticker.disabled=true;
     try{
       const r=await call('/api/conversations/'+encodeURIComponent(c.id)+'/sticker',
         {method:'PUT',body:JSON.stringify({enabled})});
       c.stickerEnabled=r.item.stickerEnabled;
       note((c.stickerEnabled?'已允许发送表情图片：':'已禁止发送表情图片：')+c.name);
     }catch(e){sticker.checked=!enabled;note(e.message,true);}
     finally{sticker.disabled=false;}
   });
   stickerCell.append(sticker);
   const autoCell=document.createElement('td'),auto=document.createElement('input');
   auto.type='checkbox';auto.checked=c.autoShareEnabled;
   auto.setAttribute('aria-label','允许定时分享 '+c.name);
   auto.title='允许定时任务向此会话发送原生视频卡片，需另行开启全局开关';
   auto.addEventListener('change',async()=>{
     const enabled=auto.checked;auto.disabled=true;
     try{
       const r=await call('/api/conversations/'+encodeURIComponent(c.id)+'/auto-share',
         {method:'PUT',body:JSON.stringify({enabled})});
       c.autoShareEnabled=r.item.autoShareEnabled;note((enabled?'已允许：':'已禁止：')+'定时分享 '+c.name);
       await loadAutomation();
     }catch(e){auto.checked=!enabled;note(e.message,true);}
     finally{auto.disabled=false;}
   });
   autoCell.append(auto);
   tr.append(name,kind,id,cell,coverCell,videoCell,stickerCell,autoCell);
   tbody.append(tr);
 }
 $('empty').hidden=items.length>0;
 $('empty').textContent=contacts.length?'没有匹配的会话':'尚未发现可核验会话，请尝试重新扫描';
}
async function load(){
 const [c,s]=await Promise.all([call('/api/conversations'),call('/api/status')]);
 contacts=c.items;$('status').textContent=s.running?'网关运行中':'网关未运行';
 $('refresh').disabled=false;draw();await loadAutomation();
}
$('connect').onclick=async()=>{
 token=$('token').value.trim();
 try{await load();sessionStorage.setItem(ADMIN_TOKEN_KEY,token);sessionStorage.removeItem(LEGACY_ADMIN_TOKEN_KEY);note('连接成功');}
 catch(e){note(e.message,true);}
};
$('refresh').onclick=async()=>{
 $('refresh').disabled=true;note('正在读取抖音网页会话列表…');
 try{
  const r=await call('/api/refresh',{method:'POST'});
  contacts=r.items;draw();
  note('扫描完成：'+r.count+' 个会话'+(r.scannedToEnd?'（列表已遍历）':'（可能未遍历全部）'));
 }catch(e){note(e.message,true);}finally{$('refresh').disabled=false;}
};
$('search').oninput=draw;$('filter').onchange=draw;
if(token)load().catch(e=>note(e.message,true));

function el(tag,value){
 const node=document.createElement(tag);
 if(value!==undefined)node.textContent=String(value);
 return node;
}
function renderAutomation(){
 if(!automationData)return;
 const a=automationData;
 $('auto-status').textContent='自动浏览：'+(a.browsingGloballyEnabled?'已开启':'总开关关闭')+
   ' ｜ 自动分享：'+(a.sharingGloballyEnabled?'已开启':'总开关关闭')+
   ' ｜ 时区：'+a.timeZone+(a.running?' ｜ 正在运行任务':'');
 const target=$('plan-target'),previous=target.value;target.replaceChildren();
 for(const c of contacts.filter(c=>c.enabled)){
   const opt=el('option',(c.kind==='group'?'群聊 · ':'私聊 · ')+c.name);
   opt.value=c.id;target.append(opt);
 }
 if([...target.options].some(x=>x.value===previous))target.value=previous;
 $('plan-create').disabled=target.options.length===0;
 const plans=$('plan-rows');plans.replaceChildren();
 for(const p of a.plans){
   const tr=el('tr'),identity=el('td'),recipient=contacts.find(c=>c.id===p.conversationId);
   identity.append(el('strong',p.name),el('div',recipient?.name??p.kind),el('small',p.topic?'主题：'+p.topic:'推荐流'));
   const browse=el('td',p.browseAt+' / '+p.browseCount+' 条');
   const share=el('td',p.shareAt+' / '+p.shareCount+' 条');
   const enabledCell=el('td'),toggle=el('input');
   toggle.type='checkbox';toggle.checked=p.enabled;toggle.setAttribute('aria-label','启用任务 '+p.name);
   toggle.onchange=async()=>{
     const enabled=toggle.checked;toggle.disabled=true;
     try{
       await call('/api/automation/plans/'+p.id,{method:'PUT',body:JSON.stringify({enabled})});
       note('计划已'+(enabled?'启用':'停用')+'：'+p.name);
       await loadAutomation();
     }catch(e){toggle.checked=!enabled;note(e.message,true);}
     finally{toggle.disabled=false;}
   };enabledCell.append(toggle);
   const browseCell=el('td'),run=el('button','手动浏览');
   run.disabled=!a.browsingGloballyEnabled||!p.enabled;
   run.onclick=async()=>{
     run.disabled=true;note('正在浏览抖音并收集候选作品：'+p.name);
     try{
       const result=await call('/api/automation/plans/'+p.id+'/browse',{method:'POST'});
       note('浏览完成：观察到 '+result.observed+' 条，新入池 '+result.added+' 条');
       await loadAutomation();
     }catch(e){note('浏览失败：'+e.message,true);}
     finally{run.disabled=false;}
   };
   browseCell.append(run);tr.append(identity,browse,share,enabledCell,browseCell);
   plans.append(tr);
 }
 const select=$('candidate-plan'),selected=select.value;select.replaceChildren();
 for(const p of a.plans){
   const opt=el('option',p.name);opt.value=p.id;select.append(opt);
 }
 if([...select.options].some(x=>x.value===selected))select.value=selected;
 $('candidate-add').disabled=select.options.length===0;
 renderCandidates();
 const receipts=$('delivery-rows');receipts.replaceChildren();
 for(const d of a.deliveries.slice(0,30)){
   const tr=el('tr');
   const first=el('td');first.append(el('code',d.videoId),el('div',new Date(d.startedAt).toLocaleString('zh-CN')));
   const status=el('td',d.status),buttons=el('td');
   if(['reserved','uncertain'].includes(d.status)){
     for(const outcome of ['confirmed','not-sent']){
       const btn=el('button',outcome==='confirmed'?'已发送':'确定未发送');
       btn.style.marginRight='6px';
       btn.onclick=async()=>{
         if(!window.confirm('请先在抖音核实该视频的真实发送结果。确定记录为'+(outcome==='confirmed'?'已发送':'确定未发送')+'？'))return;
         btn.disabled=true;
         try{
           await call('/api/automation/deliveries/'+d.id,
             {method:'PUT',body:JSON.stringify({outcome})});
           note('人工核实记录已更新');await loadAutomation();
         }catch(e){note(e.message,true);btn.disabled=false;}
       };
       buttons.append(btn);
     }
   }else buttons.textContent=d.note??'';
   tr.append(first,status,buttons);receipts.append(tr);
 }
}
function renderCandidates(){
 const tbody=$('candidate-rows');tbody.replaceChildren();
 if(!automationData)return;
 const planId=$('candidate-plan').value;
 const items=automationData.candidates?.[planId]??[];
 for(const c of items.slice(0,50)){
   const tr=el('tr'),primary=el('td');
   const link=el('a',c.title||c.videoId);
   link.href=c.url;link.target='_blank';link.rel='noopener noreferrer';
   primary.append(link,el('div',c.author||c.videoId));
   tr.append(primary,el('td',c.source),el('td',c.deliveryStatus??'候选'));
   tbody.append(tr);
 }
}
async function loadAutomation(){
 automationData=await call('/api/automation');renderAutomation();
}
$('plan-create').onclick=async()=>{
 $('plan-create').disabled=true;
 const plan={name:$('plan-name').value,conversationId:$('plan-target').value,
   topic:$('plan-topic').value,browseAt:$('plan-browse').value,
   shareAt:$('plan-share').value,browseCount:Number($('plan-browse-count').value),
   shareCount:Number($('plan-share-count').value)};
 try{
   await call('/api/automation/plans',{method:'POST',body:JSON.stringify(plan)});
   note('已创建任务，默认关闭。开启前请检查接收方和全局发送开关。');
   await loadAutomation();
 }catch(e){note(e.message,true);}
 finally{$('plan-create').disabled=false;}
};
$('candidate-plan').onchange=renderCandidates;
$('candidate-add').onclick=async()=>{
 const id=$('candidate-plan').value,url=$('candidate-url').value.trim();
 if(!id||!url)return;
 $('candidate-add').disabled=true;
 try{
   const result=await call('/api/automation/plans/'+id+'/candidates',
     {method:'POST',body:JSON.stringify({url})});
   note('候选视频已处理：新增 '+result.added+' 条');$('candidate-url').value='';
   await loadAutomation();
 }catch(e){note(e.message,true);}
 finally{$('candidate-add').disabled=false;}
};
