import { createApp } from '../../apps/api/src/app.js';
import { expect, test } from './fixtures.js';

test('finds the README edit action through a menu and distinguishes Fork from an open editor', async ({ extensionPages: { panel, grantAccess } }) => {
  const repo = 'https://github.com/octo/sample';
  const readme = '/octo/sample/blob/main/README.md';
  const edit = '/octo/sample/edit/main/README.md';
  const editor = '/octo/sample/edit/writable/README.md';
  const token = 'readme-e2e-client-token-123';
  const calls: { path: string; review: boolean; labels: string[] }[] = [];
  const origin = panel.url().replace('/sidepanel.html', '');
  let finishReview = () => {};
  let loadFileTools = () => {};
  const app = createApp({ clientToken: token, origins: [origin], async choose({ goal, page, review }) {
    calls.push({ path: page.path, review: !!review, labels: page.controls.map(control => control.label) });
    if (review) {
      await new Promise<void>(resolve => { finishReview = resolve; });
      expect(page.controls.find(control => control.id === review.targetId)?.path).toBe(readme);
      expect(review.instruction).toBe('请点击 README.md');
      expect(review.changedIds.map(id => page.controls.find(control => control.id === id)?.path)).toEqual([edit]);
      return { kind: 'highlight', targetId: review.changedIds[0], instruction: '点击预览区的编辑按钮。',
        reason: '出现了一个更短的路径。' };
    }
    const target = page.controls.find(control => control.path === edit)
      ?? page.controls.find(control => control.path === readme)
      ?? page.controls.find(control => control.label === 'More file actions')
      ?? page.controls.find(control => goal.includes('Fork') && control.label === 'Fork this repository');
    return target
      ? { kind: 'highlight', targetId: target.id, instruction: '请点击 ' + target.label }
      : { kind: 'message', instruction: '未找到可用控件。' };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const pageHtml: Record<string, string> = {
      '/octo/sample': '<h1>Sample repository</h1><a href="' + readme + '">README.md</a>',
      [readme]: '<h1>README.md</h1><a href="/octo/sample/issues">Issues</a>'
        + '<div role="menu" hidden><a role="menuitem" href="' + edit + '">Edit file</a></div>'
        + '<img src="' + repo + '/pending.svg" alt="">',
      [edit]: '<h2>You need to fork this repository to propose changes.</h2>'
        + '<button id="fork" onclick="this.textContent = \'Fork was clicked\'">Fork this repository</button>',
      [editor]: '<h1>Edit file</h1><input aria-label="File name" value="README.md">'
        + '<div class="cm-editor"><div class="cm-content" contenteditable="true">Draft</div></div>',
    };
    const context = panel.context();
    await context.route(repo + '**', async route => {
      const path = new URL(route.request().url()).pathname;
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><main>' + pageHtml[path] + '</main>' });
    });
    const site = await context.newPage();
    await context.route(repo + '/pending.svg', async route => {
      await new Promise<void>(resolve => { loadFileTools = resolve; });
      await route.fulfill({ status: 204 });
    });
    await context.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        if (!location.pathname.includes('/blob/')) return;
        setTimeout(() => {
          const button = document.createElement('button');
          button.textContent = 'More file actions';
          button.addEventListener('click', () => document.querySelector('[role=menu]')?.removeAttribute('hidden'));
          document.querySelector('main')?.append(button);
        }, 100);
      }, { once: true });
    });
    await panel.getByLabel('本机访问令牌').fill(token);
    const submit = async (task: 'readme-entry' | 'readme-editor') => {
      await panel.getByLabel('引导目标').selectOption(task);
      await site.bringToFront();
      await grantAccess(site);
      await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    };

    await site.goto(repo);
    await submit('readme-entry');
    const file = site.getByRole('link', { name: 'README.md' });
    await expect(file).toHaveClass(/driver-active-element/);
    // GitHub 首页的 README 预览可能在首次指引之后才渲染。
    await site.locator('main').evaluate((main, editUrl) => {
      const inlineEdit = document.createElement('a');
      inlineEdit.href = editUrl;
      inlineEdit.textContent = 'Edit README in preview';
      main.append(inlineEdit);
    }, edit);
    const previewEdit = site.getByRole('link', { name: 'Edit README in preview' });
    await previewEdit.hover();
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1].review).toBe(true);
    // 模型尚未回答时，网页和侧栏仍显示原指引。
    await expect(panel.getByRole('status')).toHaveText('请点击 README.md');
    await expect(file).toHaveClass(/driver-active-element/);
    finishReview();
    await site.waitForTimeout(750);
    expect(calls).toHaveLength(2);
    await expect(previewEdit).not.toHaveClass(/driver-active-element/);
    await file.click({ noWaitAfter: true });
    const more = site.getByRole('button', { name: 'More file actions' });
    await expect(more).toHaveClass(/driver-active-element/);
    expect(calls.find(call => call.path === readme)?.labels).toContain('More file actions');
    loadFileTools();
    await expect(panel.getByRole('status')).not.toContainText('已找到 README 编辑入口');
    await more.click();
    const editAction = site.getByRole('menuitem', { name: 'Edit file' });
    await expect(editAction).toHaveClass(/driver-active-element/);
    await expect(panel.getByRole('status')).toContainText('已找到 README 编辑入口');
    await editAction.click();
    await expect(panel.getByRole('status')).toHaveText('已找到 README 编辑入口。GitHub 要求先 Fork 才能继续。');
    expect(calls.some(call => call.path === edit)).toBe(false);
    const fork = site.getByRole('button', { name: 'Fork this repository' });
    await expect(fork).not.toHaveClass(/driver-active-element/);

    await site.goto('https://github.com' + readme, { waitUntil: 'domcontentloaded' });
    await submit('readme-entry');
    await expect(more).toHaveClass(/driver-active-element/);
    loadFileTools();

    await site.goto('https://github.com' + edit);
    await submit('readme-editor');
    await expect(fork).toHaveClass(/driver-active-element/);
    await expect(panel.getByRole('status')).toContainText('GitHub 要求先 Fork。请点击 Fork this repository');
    await expect(panel.getByRole('status')).not.toContainText('已进入 README 编辑器');

    const previousCalls = calls.length;
    await site.goto('https://github.com' + editor);
    await expect(panel.getByRole('status')).toHaveText('已进入 README 编辑器。');
    expect(calls).toHaveLength(previousCalls);
    await expect(site.locator('.webguide-popover')).toHaveCount(0);
  } finally {
    finishReview();
    loadFileTools();
    await app.close();
  }
});
