import path from 'node:path';
export function configFromEnv(env = process.env) {
  const pollMs = Number(env.POLL_MS ?? 2500);
  if (!Number.isInteger(pollMs) || pollMs < 1000) throw Error('POLL_MS must be >= 1000');
  const url = new URL(env.ONEBOT_WS_URL ?? 'ws://127.0.0.1:6200/ws');
  if (!['ws:', 'wss:'].includes(url.protocol)) throw Error('ONEBOT_WS_URL must be ws(s)');
  return {
    url: url.toString(), token: env.ONEBOT_ACCESS_TOKEN ?? '',
    upstream: path.resolve(env.UPSTREAM_DIR ?? './upstream/dsh-douyin-agent'),
    data: path.resolve(env.DATA_DIR ?? './data'), pollMs,
    allowlist: new Set((env.ALLOWED_CONVERSATIONS ?? '').split(',').map(x => x.trim()).filter(Boolean)),
    enableSending: env.ENABLE_SENDING === 'true',
    groupTrigger: env.GROUP_TRIGGER ?? 'all'
  };
}
