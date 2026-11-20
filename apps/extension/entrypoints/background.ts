import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { chooseNavigation } from '../src/navigation/model-client.js';
import type { ModelRequest } from '../src/navigation/protocol.js';

export default defineBackground(() => {
  browser.action.onClicked.addListener(tab => {
    if (typeof tab.windowId !== 'number') return;
    // 直接在工具栏点击事件中打开侧栏，保留浏览器要求的用户操作上下文。
    void browser.sidePanel.open({ windowId: tab.windowId }).catch(console.warn);
  });
  browser.runtime.onMessage.addListener((message: ModelRequest, sender) => {
    // 网页脚本只提供页面快照。只有扩展自己的侧栏可以请求模型服务。
    if (sender.id !== browser.runtime.id || sender.url !== globalThis.location.origin + '/sidepanel.html'
      || message?.kind !== 'choose-navigation') return;
    return chooseNavigation(message);
  });
});
