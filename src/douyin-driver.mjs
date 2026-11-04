import { pathToFileURL } from 'node:url';
import path from 'node:path';
// Dynamic import: upstream checkout must exist; upstream is not a separately running server.
export async function loadDriver(upstreamDir) {
  const url = pathToFileURL(path.join(upstreamDir, 'chat-browser.mjs')).href;
  const { ChatBrowser } = await import(url);
  return new ChatBrowser({ source: 'api-chat' });
}
export function validatedContact(c) {
  return c && /^conv:[a-f0-9]{64}$/.test(c.id ?? '') && c.identityVerified === true &&
    c.identityVersion === 2 && typeof c.isGroup === 'boolean' &&
    typeof c.identityBinding === 'string' && /^binding:[a-f0-9]{64}$/.test(c.identityBinding);
}
