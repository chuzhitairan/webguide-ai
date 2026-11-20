import { expect, test } from './fixtures.js';
import { createApp } from '../../apps/api/src/app.js';

test('loads the real-time navigation sidebar from the production extension', async ({ extensionPages: { panel } }) => {
  await expect(panel.getByRole('heading', { name: '实时网页引导' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '开始引导' })).toBeDisabled();
});

test('highlights each model-selected control and confirms the issue after the user clicks', async ({ extensionPages: { panel, grantAccess } }) => {
  const repo = 'https://github.com/webguide-test/sample';
  const issuePath = '/webguide-test/sample/issues/17';
  const token = 'navigation-e2e-client-token-123';
  const calls: string[] = [];
  const origin = panel.url().replace('/sidepanel.html', '');
  const app = createApp({ clientToken: token, origins: [origin], async choose({ page }) {
    calls.push(page.path);
    const path = page.path.endsWith('/issues') ? issuePath : '/webguide-test/sample/issues';
    const target = page.controls.find(control => control.path === path);
    const updatedCopy = calls.length === 2 ? '（已更新）' : '';
    return target
      ? { kind: 'highlight', targetId: target.id, instruction: '点击 ' + target.label + updatedCopy }
      : { kind: 'message', instruction: '没有找到目标。' };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  let releaseImage = () => {};
  try {
    const context = panel.context();
    await context.route(repo + '**', async route => {
      const path = new URL(route.request().url()).pathname;
      const content = path === issuePath
        ? '<h1>Loading issue</h1><a href="../issues">Back to issues</a>'
          + '<script>setTimeout(() => { document.querySelector("h1").innerHTML = '
          + "'<span data-testid=\"issue-title\">Improve setup</span> <span>#17</span>'; }, 400)</script>"
        : path.endsWith('/issues')
          ? '<h1>Issues</h1><a href="' + issuePath + '">Improve setup</a>'
          : '<h1>Sample repository</h1><nav><a href="' + repo + '/issues">Issues</a></nav>'
            + '<img alt="" src="' + repo + '/slow.svg">';
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><main>' + content + '</main>' });
    });
    let notifyImageRequested = () => {};
    const imageRequested = new Promise<void>(resolve => { notifyImageRequested = resolve; });
    await context.route(repo + '/slow.svg', async route => {
      notifyImageRequested();
      await new Promise<void>(unblock => { releaseImage = unblock; });
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    });
    const site = await context.newPage();
    await site.goto(repo, { waitUntil: 'domcontentloaded' });
    await imageRequested;
    await site.bringToFront();
    await grantAccess(site);
    await panel.getByLabel('Issue 编号').fill('17');
    await panel.getByLabel('本机访问令牌').fill(token);
    await site.bringToFront();
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());

    const issues = site.getByRole('link', { name: 'Issues', exact: true });
    await expect(issues).toHaveClass(/driver-active-element/);
    await expect(site.locator('.webguide-popover')).toContainText('点击 Issues');
    expect(site.url()).toBe(repo);
    releaseImage();
    const popover = site.locator('.webguide-popover');
    await popover.evaluate(element => element.setAttribute('data-test-popover', 'original'));
    await site.locator('main').evaluate(main => {
      const button = document.createElement('button');
      button.textContent = 'Other action';
      main.append(button);
    });
    // 邻近控件变化后，等待整个观察窗口过去再比对本页的请求与提示。
    await site.waitForTimeout(850);
    expect(calls).toEqual(['/webguide-test/sample']);
    await expect(panel.getByRole('status')).toHaveText('点击 Issues');
    await expect(popover).toHaveAttribute('data-test-popover', 'original');
    await expect(popover).toContainText('点击 Issues');

    // 如果原按钮真的被页面替换，就重新找仍可操作的控件。
    await issues.evaluate(link => {
      const replacement = document.createElement('a');
      replacement.href = (link as HTMLAnchorElement).href;
      replacement.textContent = link.textContent;
      link.replaceWith(replacement);
    });
    await expect(issues).toHaveClass(/driver-active-element/);
    await expect(panel.getByRole('status')).toHaveText('点击 Issues（已更新）');

    await issues.click();
    const target = site.getByRole('link', { name: 'Improve setup' });
    await expect(target).toHaveClass(/driver-active-element/);
    await target.click();
    await expect(panel.getByRole('status')).toHaveText('已打开 Issue #17');
    await expect(site.locator('.webguide-popover')).toHaveCount(0);
    expect(calls).toEqual(['/webguide-test/sample', '/webguide-test/sample', '/webguide-test/sample/issues']);

    await site.goto(repo + '/issues');
    await site.bringToFront();
    await grantAccess(site);
    await site.bringToFront();
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(target).toHaveClass(/driver-active-element/);
    await target.click();
    await expect(panel.getByRole('status')).toHaveText('已打开 Issue #17');
    expect(calls.at(-1)).toBe('/webguide-test/sample/issues');
  } finally {
    releaseImage();
    await app.close();
  }
});
