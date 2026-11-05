import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('public repository bootstrap uses current URL and correct license',()=>{
  assert.match(read('README.md'),/git clone https:\/\/github\.com\/emperor-hh\/DouyinBridge\.git/);
  assert.doesNotMatch(read('README.md'),/git clone https:\/\/github\.com\/emperor-hh\/DouyinLuma/);
  assert.match(read('SECURITY.md'),/漏洞|Security/);
  assert.match(read('CONTRIBUTING.md'),/贡献/);
  assert.match(read('LICENSE'),/Apache License/);
});
test('third-party patch removed from publication tree',()=>{
  assert.equal(existsSync(new URL('../docs/patches/private-companion-douyin-media.patch',import.meta.url)),false);
  assert.equal(existsSync(new URL('../docs/patches/README.md',import.meta.url)),false);
  assert.match(read('THIRD_PARTY_NOTICES.md'),/历史|history/);
});
test('sensitive runtime data are excluded by gitignore',()=>{
  const g=read('.gitignore');
  for(const rule of ['.env.*','!.env.example','/data/','/upstream/','*.sqlite','*.db','**/browser-profile/','*.pem','*.key'])
    assert.ok(g.includes(rule),'missing ignore rule '+rule);
});
