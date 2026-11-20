import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';

export default defineBackground(() => {
  browser.action.onClicked.addListener(tab => {
    if (typeof tab.windowId !== 'number') return;
    // 直接在工具栏点击事件中打开侧栏，保留浏览器要求的用户操作上下文。
    void browser.sidePanel.open({ windowId: tab.windowId }).catch(console.warn);
  });
});
