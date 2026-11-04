import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocketServer} from 'ws';
import {OneBotClient} from '../src/onebot.mjs';
test('reverse websocket sends identity, role, token and handles actions', {timeout:5000}, async()=>{
  const server=new WebSocketServer({host:'127.0.0.1',port:0});
  await once(server,'listening');
  const client=new OneBotClient({url:`ws://127.0.0.1:${server.address().port}/ws`,token:'test-token',selfId:42,actions:async action=>({action})});
  try {
    const connected=once(server,'connection');client.connect();
    const [socket,req]=await connected;
    assert.equal(req.headers['x-self-id'],'42');
    assert.equal(req.headers['x-client-role'],'Universal');
    assert.equal(req.headers.authorization,'Bearer test-token');
    const response=new Promise(resolve=>socket.on('message',raw=>{const data=JSON.parse(String(raw));if(data.echo==='check')resolve(data);}));
    socket.send(JSON.stringify({action:'get_status',echo:'check'}));
    assert.deepEqual(await response,{status:'ok',retcode:0,data:{action:'get_status'},echo:'check'});
  } finally {client.close();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));}
});