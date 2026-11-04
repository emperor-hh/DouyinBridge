'use strict';
const $=id=>document.getElementById(id);
let token=sessionStorage.getItem('douyinluma-admin')??'';
let contacts=[];
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
   stickerCell.append(sticker);tr.append(name,kind,id,cell,coverCell,videoCell,stickerCell);tbody.append(tr);
 }
 $('empty').hidden=items.length>0;
 $('empty').textContent=contacts.length?'没有匹配的会话':'尚未发现可核验会话，请尝试重新扫描';
}
async function load(){
 const [c,s]=await Promise.all([call('/api/conversations'),call('/api/status')]);
 contacts=c.items;$('status').textContent=s.running?'网关运行中':'网关未运行';
 $('refresh').disabled=false;draw();
}
$('connect').onclick=async()=>{
 token=$('token').value.trim();
 try{await load();sessionStorage.setItem('douyinluma-admin',token);note('连接成功');}
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
