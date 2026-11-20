import { createApp } from '../../apps/api/src/app.js';
import { expect, test } from './fixtures.js';

test('reviews a late task-relevant control and ignores a review completed after navigation', async ({ extensionPages: { panel, grantAccess } }) => {
  const home = '/octo/adaptive';
  const issues = home + '/issues';
  const wanted = issues + '/17';
  const token = 'adaptive-e2e-client-token-123';
  const reviews: string[][] = [];
  let finishReview = () => {};
  const app = createApp({
    clientToken: token, origins: [panel.url().replace('/sidepanel.html', '')],
    async choose({ page, review }) {
      if (!review) {
        const target = page.controls.find(control => control.label === 'Search' || control.path === wanted);
        return target && { kind: 'highlight', targetId: target.id, instruction: '点击 ' + target.label };
      }
      const changed = page.controls.filter(control => review.changedIds.includes(control.id));
      reviews.push(changed.map(control => control.label));
      await new Promise<void>(resolve => { finishReview = resolve; });
      if (changed[0].label === 'Late direct link') {
        return { kind: 'message', instruction: '旧页面已完成复核。', reason: '这是上一个页面的回复。' };
      }
      return { kind: 'highlight', targetId: changed[0].id, instruction: '点击 ' + changed[0].label,
        reason: '页面出现了更明确的入口。' };
    },
  });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route('https://github.com/octo/adaptive**', route => {
      const path = new URL(route.request().url()).pathname;
      const content = path === home ? '<button>Search</button>' : '<a href="' + wanted + '">Issue from list</a>';
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><main>' + content + '</main>' });
    });
    const site = await context.newPage();
    await site.goto('https://github.com' + home);
    await site.bringToFront();
    await grantAccess(site);
    await panel.getByLabel('本机访问令牌').fill(token);
    await panel.getByLabel('Issue 编号').fill('17');
    await site.bringToFront();
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    const search = site.getByRole('button', { name: 'Search' });
    await expect(search).toHaveClass(/driver-active-element/);

    const addLink = (path: string, label: string) => site.locator('main').evaluate((main, link) => {
      const anchor = document.createElement('a');
      anchor.href = link.path;
      anchor.textContent = link.label;
      main.append(anchor);
    }, { path, label });
    await addLink(home + '/pulls', 'Pull requests');
    await addLink(issues, 'Issues');
    await expect.poll(() => reviews).toEqual([['Issues']]);
    await expect(search).toHaveClass(/driver-active-element/);
    await expect(panel.getByRole('status')).toHaveText('点击 Search');
    finishReview();
    const issuesLink = site.getByRole('link', { name: 'Issues', exact: true });
    await expect(issuesLink).toHaveClass(/driver-active-element/);
    await expect(panel.getByRole('status')).toHaveText('页面出现了更明确的入口。 点击 Issues');

    await addLink(wanted, 'Late direct link');
    await expect.poll(() => reviews).toEqual([['Issues'], ['Late direct link']]);
    await issuesLink.click();
    const fresh = site.getByRole('link', { name: 'Issue from list' });
    await expect(fresh).toHaveClass(/driver-active-element/);
    finishReview();
    await site.waitForTimeout(350);
    await expect(panel.getByRole('status')).toHaveText('点击 Issue from list');
    await expect(fresh).toHaveClass(/driver-active-element/);
  } finally {
    finishReview();
    await app.close();
  }
});
