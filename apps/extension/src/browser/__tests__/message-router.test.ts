import { describe, expect, it } from 'vitest';
import { getPageSender, getUiWindow } from '../message-router.js';

const extensionId = 'abcd';
const endpoint = 'chrome-extension://abcd/sidepanel.html';

describe('浏览器消息身份', () => {
  it('从真实测试页所在窗口取身份，忽略页面自报的窗口', () => {
    const sender = { id: extensionId, url: endpoint, tab: { id: 4, windowId: 7 } };
    expect(getUiWindow(sender, extensionId, true, undefined)).toBe(7);
    expect(getUiWindow(sender, extensionId, false, undefined)).toBeUndefined();
  });

  it('原生侧栏使用经工具栏打开的浏览器上下文', () => {
    const sender = { id: extensionId, url: endpoint, documentId: 'panel' };
    expect(getUiWindow(sender, extensionId, false, 3)).toBe(3);
    expect(getUiWindow(sender, extensionId, false, undefined)).toBeUndefined();
    expect(getUiWindow({ ...sender, url: 'chrome-extension://abcd/other.html' }, extensionId, false, 3))
      .toBeUndefined();
  });

  it('主文档身份来自浏览器；子框架、旧文档和其他窗口均拒绝', () => {
    const sender = { id: extensionId, url: 'http://127.0.0.1:43131/fixture-team/guide/issue?number=1',
      documentId: 'current', frameId: 0, tab: { id: 1, windowId: 2 } };
    expect(getPageSender(sender, extensionId, 2, 'current')).toMatchObject({ kind: 'page', tabId: 1, documentId: 'current' });
    expect(getPageSender(sender, extensionId, 3, 'current')).toBeUndefined();
    expect(getPageSender(sender, extensionId, 2, 'new')).toBeUndefined();
    expect(getPageSender({ ...sender, frameId: 1 }, extensionId, 2, 'current')).toBeUndefined();
  });
});