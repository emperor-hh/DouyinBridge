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
    const chat=createVerifiedChatBrowser(ChatBrowser,{source:'api-chat',controller});
    return {
      session, chat,
      listContacts: options=>chat.listContacts(options),
      readConversation: (id,options)=>chat.readConversation(id,options),
      captureMessage: (id,messageId,options)=>chat.captureMessage(id,messageId,options),
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

// Explicit database approval is independent of following-list discovery.
// Keep the stored stable identity binding mandatory even for manual approval.
export function createVerifiedChatBrowser(ChatBrowser, options) {
  return new (class extends ChatBrowser {
    async verifyContactBinding(page, contact, expectedContact, weak = false) {
      const current = await super.verifyContactBinding(page, contact, expectedContact, weak);
      if (expectedContact && (!validatedContact(expectedContact) || !validatedContact(current) ||
        ['id','isGroup','identityVersion','identityKind','identityHash','identityBinding']
          .some(key => expectedContact[key] !== current[key]))) {
        throw Error('授权会话的稳定身份或绑定已变化，未继续发送。');
      }
      return current;
    }
  })(options);
}