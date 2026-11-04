import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createBrowserSession } from './browser-session.mjs';

export async function loadDriver({upstreamDir,profileDir,headless=true,browserChannel='chromium',chromiumImpl} = {}) {
  const url=pathToFileURL(path.join(upstreamDir,'chat-browser.mjs')).href;
  const { ChatBrowser }=await import(url);
  const session=await createBrowserSession({upstreamDir,profileDir,headless,browserChannel,chromiumImpl});
  try {
    const controllerModule=await import(pathToFileURL(path.join(upstreamDir,'core.mjs')).href);
    const controller=new controllerModule.BrowserController({
      source:'api-chat',
      controlDirectory:path.join(profileDir,'control')
    });
    controller.browser=session.browser;
    // BrowserController otherwise connects to its hard-coded managed Edge CDP.
    // Pre-provision a page and inject our managed Chromium session.
    await session.prepareChatPage();
    const chat=new ChatBrowser({source:'api-chat',controller});
    return {
      session, chat,
      listContacts: options=>chat.listContacts(options),
      readConversation: (id,options)=>chat.readConversation(id,options),
      sendMessage: (id,text,options)=>chat.sendMessage(id,text,options),
      prepareChat: options=>chat.prepareChat(options),
      close:()=>session.close()
    };
  } catch(error) {
    await session.close().catch(()=>{});
    throw error;
  }
}
export function validatedContact(c) {
  return Boolean(c && /^conv:[a-f0-9]{64}$/.test(c.id ?? '') && c.identityVerified === true &&
    c.identityVersion === 2 && typeof c.isGroup === 'boolean' &&
    typeof c.identityBinding === 'string' && /^binding:[a-f0-9]{64}$/.test(c.identityBinding));
}
