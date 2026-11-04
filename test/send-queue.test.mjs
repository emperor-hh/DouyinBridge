import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Gateway} from '../src/gateway.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 const c={id:'conv:'+'a'.repeat(64),isGroup:false,identityVerified:true,identityVersion:2,identityBinding:'binding:'+'b'.repeat(64)};
 let enabled=true;const sent=[],entered=deferred(),release=deferred();
 const driver={readConversation:async()=>({messages:sent.map((_,i)=>({id:String(i)}))}),sendMessage:async(_id,text,options)=>{sent.push({text,watermark:options.expectedMessageIds});if(sent.length===1){entered.resolve();await release.promise;}return {confirmed:true,messageId:String(sent.length)};}};
 const g=new Gateway({driver,store:{lookup:()=>c.id,id:()=>1},client:{},config:{enableSending:true},allowlist:{allowed:()=>enabled}});g.contacts.set(c.id,c);
 return {g,driver,sent,entered,release,revoke:()=>{enabled=false;}};
}
test('concurrent reply segments are sent in order with refreshed watermarks',async()=>{
 const f=fixture();const first=f.g.send('private',1,'first');await f.entered.promise;
 const second=f.g.send('private',1,'second'),third=f.g.send('private',1,'third');
 assert.equal(f.sent.length,1);f.release.resolve();await Promise.all([first,second,third]);
 assert.deepEqual(f.sent,[{text:'first',watermark:[]},{text:'second',watermark:['0']},{text:'third',watermark:['0','1']}]);assert.equal(f.g.pendingSends,0);
});
test('queued segments recheck revocation and the queue recovers after failure',async()=>{
 const f=fixture();const first=f.g.send('private',1,'first');await f.entered.promise;
 const second=f.g.send('private',1,'second');const rejected=assert.rejects(second,/no longer authorized/);
 f.revoke();f.release.resolve();await first;await rejected;assert.equal(f.sent.length,1);assert.equal(f.g.pendingSends,0);
});
test('uncertain delivery cancels already queued segments without retrying',async()=>{
 const f=fixture();f.driver.sendMessage=async()=>{f.sent.push(1);f.entered.resolve();await f.release.promise;return {confirmed:false,deliveryUncertain:true};};
 const first=f.g.send('private',1,'first');await f.entered.promise;
 const second=f.g.send('private',1,'second');
 const results=Promise.allSettled([first,second]);f.release.resolve();
 for(const result of await results){assert.equal(result.status,'rejected');assert.equal(result.reason.retcode,1502);}
 assert.equal(f.sent.length,1);
});
test('send queue is bounded and does not dispatch overflow',async()=>{
 const f=fixture();const sends=[f.g.send('private',1,'first')];await f.entered.promise;
 for(let i=0;i<15;i++)sends.push(f.g.send('private',1,'part'+i));
 await assert.rejects(f.g.send('private',1,'overflow'),/queue full/);
 f.release.resolve();await Promise.all(sends);assert.equal(f.sent.length,16);
});