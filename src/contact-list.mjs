import { validatedContact } from './douyin-driver.mjs';

export function summarizeContactListing(result) {
  const contacts = Array.isArray(result) ? result : result?.contacts;
  if (!Array.isArray(contacts)) {
    throw new Error('未获取到会话列表：请检查抖音登录状态、验证页面或消息面板是否正常。');
  }
  const entries = contacts.map(c => {
    const verified = validatedContact(c);
    return {
      type: c?.isGroup === true ? 'group' : c?.isGroup === false ? 'private' : 'unknown',
      name: String(c?.displayName ?? c?.name ?? '(未命名会话)').trim(),
      id: verified ? c.id : null,
      verified,
      status: verified ? 'ready' : 'unverified'
    };
  }).sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name,'zh-CN'));
  const usable = entries.filter(c=>c.verified);
  const discovery = result?.listDiscovery ?? {};
  return {
    contacts:entries,
    usableCount:usable.length,
    totalCount:entries.length,
    scannedToEnd:discovery.scannedToEnd === true,
    note:discovery.note ?? '只包含当前网页消息列表可见或可遍历的会话，并非全平台好友或群聊列表。',
    reason:discovery.reason ?? null,
    blocked:result?.blocked === true,
    loginRequired:result?.loginRequired === true,
    verificationRequired:result?.verificationRequired === true,
    allowlist:usable.map(c=>c.id).join(',')
  };
}

export function formatContactListing(data) {
  const lines=['DouyinBridge 联系人查询（只读）',''];
  if(data.blocked||data.loginRequired||data.verificationRequired) {
    lines.push('警告：网页可能需要登录或人工验证，当前结果不完整。','');
  }
  for(const c of data.contacts) {
    const kind=c.type==='group'?'群聊':c.type==='private'?'私聊':'未知';
    lines.push(`[${kind}] ${c.name}`);
    lines.push(`  状态：${c.verified?'已核验':'身份未核验（不能加入白名单）'}`);
    lines.push(`  ID：${c.id??'(不可用)'}`,'');
  }
  lines.push(`共发现 ${data.totalCount} 个会话，可用 ID ${data.usableCount} 个。`);
  lines.push(`列表是否完整扫描：${data.scannedToEnd?'是':'未确认'}`);
  lines.push(data.note);
  if(data.reason)lines.push(`补充说明：${data.reason}`);
  lines.push('','请从以上已核验会话中选择需要授权的 ID；不要直接把全部会话自动加入白名单。');
  return lines.join('\n');
}
