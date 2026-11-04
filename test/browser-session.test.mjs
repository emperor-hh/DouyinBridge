import {test} from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';import fs from 'node:fs';import path from 'node:path';
import {configFromEnv} from '../src/config.mjs';
import {createBrowserSession} from '../src/browser-session.mjs';
function stub(){
  const calls={};
  const page={url:()=>calls.url??'about:blank',isClosed:()=>false,
    evaluate:async(_fn,name)=>{calls.label=name;},
    goto:async(url)=>{calls.url=url;}};
  const context={pages:()=>[page],newPage:async()=>page,close:async()=>{calls.closed=true;},
    addInitScript:async()=>{calls.initScript=true;}};
  return {calls,chromium:{launchPersistentContext:async(dir,options)=>{calls.dir=dir;calls.options=options;return context;}}};
}
test('headless default and visible override',()=>{
 assert.equal(configFromEnv({}).browserMode,'headless');
 assert.equal(configFromEnv({BROWSER_MODE:'visible'}).browserMode,'visible');
 assert.throws(()=>configFromEnv({BROWSER_MODE:'invalid'}),/BROWSER_MODE/);
});
test('headless Chromium persistent profile and stop',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dyl-browser-'));const fake=stub();
 const session=await createBrowserSession({profileDir:path.join(dir,'profile'),upstreamDir:dir,chromiumImpl:fake.chromium});
 assert.equal(fake.calls.options.headless,true);assert.equal(fake.calls.options.channel,'chromium');
 assert.equal(fake.calls.dir,path.join(dir,'profile'));assert.equal(fake.calls.initScript,true);
 await session.prepareChatPage();assert.equal(fake.calls.label,'deepseek-douyin-api-chat');
 assert.equal(session.browser.isConnected(),true);await session.close();
 assert.equal(session.browser.isConnected(),false);assert.equal(fake.calls.closed,true);
 fs.rmSync(dir,{recursive:true,force:true});
});
test('login flow uses visible Chromium',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dyl-browser-'));const fake=stub();
 const session=await createBrowserSession({profileDir:path.join(dir,'profile'),upstreamDir:dir,headless:false,browserChannel:'msedge',chromiumImpl:fake.chromium});
 const p=await session.openLoginPage();
 assert.equal(fake.calls.options.headless,false);assert.equal(fake.calls.options.channel,'msedge');
 assert.equal(p.url(),'https://www.douyin.com/');
 await session.close();fs.rmSync(dir,{recursive:true,force:true});
});
