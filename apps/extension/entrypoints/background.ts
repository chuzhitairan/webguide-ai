import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { bindingKey } from '../src/guide/browser-link.js';

export default defineBackground(() => {
  browser.action.onClicked.addListener(tab => {
    if (typeof tab.windowId !== 'number') return;
    if (typeof tab.id === 'number' && tab.url && /^https?:\/\//.test(tab.url)) {
      void browser.storage.session.set({
        [bindingKey(tab.windowId)]: { tabId: tab.id, origin: new URL(tab.url).origin },
      }).catch(console.warn);
    } else {
      void browser.storage.session.remove(bindingKey(tab.windowId)).catch(console.warn);
    }
    // 直接在工具栏点击事件中打开侧栏，保留浏览器要求的用户操作上下文。
    void browser.sidePanel.open({ windowId: tab.windowId }).catch(console.warn);
  });
});
