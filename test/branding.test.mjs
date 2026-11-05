import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=(file)=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('project name and npm metadata consistently use DouyinBridge',()=>{
  const pkg=JSON.parse(source('package.json'));
  const lock=JSON.parse(source('package-lock.json'));
  assert.equal(pkg.name,'douyinbridge');
  assert.equal(lock.name,'douyinbridge');
  assert.equal(lock.packages[''].name,'douyinbridge');
  assert.equal(pkg.version,lock.version);
  assert.equal(pkg.license,'Apache-2.0');
  assert.equal(pkg.repository.url,'git+https://github.com/emperor-hh/DouyinBridge.git');
  assert.match(source('README.md'),/^# DouyinBridge\s*$/m);
  assert.match(source('web/index.html'),/<title>DouyinBridge 控制台<\/title>/);
  assert.match(source('web/index.html'),/<h1>DouyinBridge<\/h1>/);
});

test('admin token migration keeps old sessionStorage token working',()=>{
  const app=source('web/app.js');
  assert.match(app,/ADMIN_TOKEN_KEY='douyinbridge-admin'/);
  assert.match(app,/LEGACY_ADMIN_TOKEN_KEY='douyinluma-admin'/);
  assert.match(app,/sessionStorage\.getItem\(LEGACY_ADMIN_TOKEN_KEY\)/);
  assert.match(app,/sessionStorage\.removeItem\(LEGACY_ADMIN_TOKEN_KEY\)/);
});

test('internal playback permission mark is consistent for sampler and browser',()=>{
  for(const file of ['src/browser-session.mjs','src/video-sampler.mjs','src/automation-browser.mjs'])
    assert.match(source(file),/__douyinbridgeSamplingAuthorized/);
});

test('license and attribution are unchanged by the rename',()=>{
  assert.match(source('NOTICE'),/Copyright 2026 emperor-hh and DouyinBridge contributors/);
  assert.match(source('NOTICE'),/previously known as DouyinLuma/);
  assert.match(source('LICENSE'),/Apache License/);
  assert.match(source('THIRD_PARTY_NOTICES.md'),/dsh-douyin-agent/);
});
