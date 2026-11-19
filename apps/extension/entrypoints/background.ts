import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { startFixtureBackground } from '../src/browser/fixture-background.js';

export default defineBackground(() => {
  const openedWindows = new Set<number>();
  browser.action.onClicked.addListener(tab => {
    if (typeof tab.windowId !== 'number') return;
    openedWindows.add(tab.windowId);
    void browser.sidePanel.open({ windowId: tab.windowId }).catch(() => openedWindows.delete(tab.windowId));
  });
  if (__WEBGUIDE_FIXTURE__) startFixtureBackground(openedWindows);
});