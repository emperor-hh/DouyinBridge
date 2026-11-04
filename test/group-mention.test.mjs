import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Gateway} from '../src/gateway.mjs';
test('AstrBot can resolve self mentions only in an authorized group',async()=>{
 const c={id:'conv:'+'a'.repeat(64),isGroup:true,identityVerified:true,identityVersion:2,identityBinding:'binding:'+'b'.repeat(64)};
 let enabled=true;
 const gateway=new Gateway({store:{lookup:(kind,id)=>kind==='group'&&id===7?c.id:null},allowlist:{allowed:()=>enabled}});
 gateway.contacts.set(c.id,c);
 const info=await gateway.actions('get_group_member_info',{group_id:7,user_id:990000001});
 assert.equal(info.user_id,990000001);assert.ok(info.card);
 await assert.rejects(gateway.actions('get_group_member_info',{group_id:7,user_id:123}),/unavailable/);
 await assert.rejects(gateway.actions('get_group_member_info',{group_id:8,user_id:990000001}),/no longer authorized/);
 enabled=false;
 await assert.rejects(gateway.actions('get_group_member_info',{group_id:7,user_id:990000001}),/no longer authorized/);
});