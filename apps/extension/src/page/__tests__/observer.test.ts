// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { watchPage } from '../observer.js';

it('报告页面变更和导航，停止后取消所有订阅', async () => {
  const checkTarget = vi.fn();
  const notify = vi.fn();
  const button = document.createElement('button');
  document.body.append(button);
  const stop = watchPage(document, checkTarget, notify);
  try {
    button.textContent = 'Next';
    await Promise.resolve();
    expect(checkTarget).toHaveBeenCalledOnce();

    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(notify).toHaveBeenCalledExactlyOnceWith('page-left');

    stop();
    button.remove();
    window.dispatchEvent(new PopStateEvent('popstate'));
    await Promise.resolve();
    expect(checkTarget).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
  } finally {
    stop();
    button.remove();
  }
});
