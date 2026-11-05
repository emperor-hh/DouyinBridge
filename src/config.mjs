import path from 'node:path';
export function configFromEnv(env=process.env){
  const pollMs=Number(env.POLL_MS??2500);
  if(!Number.isInteger(pollMs)||pollMs<1000)throw Error('POLL_MS must be >= 1000');
  const url=new URL(env.ONEBOT_WS_URL??'ws://127.0.0.1:6200/ws');
  if(!['ws:','wss:'].includes(url.protocol))throw Error('ONEBOT_WS_URL must be ws(s)');
  const browserMode=(env.BROWSER_MODE??'headless').trim().toLowerCase();
  if(!['headless','visible'].includes(browserMode))throw Error('BROWSER_MODE must be headless or visible');
  const browserChannel=(env.BROWSER_CHANNEL??'chromium').trim().toLowerCase();
  if(!['chromium','msedge','bundled'].includes(browserChannel))throw Error('BROWSER_CHANNEL must be chromium, msedge or bundled');
  const adminPort=Number(env.ADMIN_PORT??3219);
  if(!Number.isInteger(adminPort)||adminPort<1||adminPort>65535)throw Error('ADMIN_PORT must be 1-65535');
  const videoSampleSeconds=Number(env.VIDEO_SAMPLE_SECONDS??3);
  if(!Number.isFinite(videoSampleSeconds)||videoSampleSeconds<1||videoSampleSeconds>5)
    throw Error('VIDEO_SAMPLE_SECONDS must be 1-5');
  const data=path.resolve(env.DATA_DIR??'./data');
  return {
    url:url.toString(),token:env.ONEBOT_ACCESS_TOKEN??'',
    upstream:path.resolve(env.UPSTREAM_DIR??'./upstream/dsh-douyin-agent'),
    data,profileDir:path.resolve(env.BROWSER_PROFILE_DIR??path.join(data,'browser-profile')),
    browserMode,browserChannel,pollMs,adminPort,adminToken:env.ADMIN_TOKEN??'',
    // Migrates legacy IDs once into SQLite; no longer the source of truth.
    allowlist:new Set((env.ALLOWED_CONVERSATIONS??'').split(',').map(x=>x.trim()).filter(Boolean)),
    enableSending:env.ENABLE_SENDING==='true',enableImageSending:env.ENABLE_IMAGE_SENDING==='true',
    receiveStickers:env.RECEIVE_STICKERS!=='false',groupTrigger:env.GROUP_TRIGGER??'all',
    shareForwarding:env.SHARED_VIDEO_FORWARDING!=='false',videoSampleSeconds,
    enableAutoBrowsing:env.ENABLE_AUTO_BROWSING==='true',
    enableAutoSharing:env.ENABLE_AUTO_SHARING==='true'
  };
}
