import path from 'node:path';
export function configFromEnv(env=process.env) {
  const pollMs=Number(env.POLL_MS??2500);
  if(!Number.isInteger(pollMs)||pollMs<1000)throw Error('POLL_MS must be >= 1000');
  const url=new URL(env.ONEBOT_WS_URL??'ws://127.0.0.1:6200/ws');
  if(!['ws:','wss:'].includes(url.protocol))throw Error('ONEBOT_WS_URL must be ws(s)');
  const browserMode=(env.BROWSER_MODE??'headless').trim().toLowerCase();
  if(!['headless','visible'].includes(browserMode))throw Error('BROWSER_MODE must be headless or visible');
  const browserChannel=(env.BROWSER_CHANNEL??'chromium').trim().toLowerCase();
  if(!['chromium','msedge','bundled'].includes(browserChannel))throw Error('BROWSER_CHANNEL must be chromium, msedge or bundled');
  const data=path.resolve(env.DATA_DIR??'./data');
  const profileDir=path.resolve(env.BROWSER_PROFILE_DIR??path.join(data,'browser-profile'));
  return {
    url:url.toString(),token:env.ONEBOT_ACCESS_TOKEN??'',
    upstream:path.resolve(env.UPSTREAM_DIR??'./upstream/dsh-douyin-agent'),
    data,profileDir,browserMode,browserChannel,pollMs,
    allowlist:new Set((env.ALLOWED_CONVERSATIONS??'').split(',').map(x=>x.trim()).filter(Boolean)),
    enableSending:env.ENABLE_SENDING==='true',
    groupTrigger:env.GROUP_TRIGGER??'all'
  };
}
