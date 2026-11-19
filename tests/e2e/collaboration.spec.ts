import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.js';

// Keep the website active while the same sidebar App runs in a test-only
// extension tab. This gives page visibility and sender checks real inputs.
async function sidebar(site: Page, panel: Page, button: string): Promise<void> {
  await site.bringToFront();
  const control = panel.getByRole('button', { name: button, exact: true });
  await expect(control).toBeEnabled();
  await control.evaluate((element: HTMLButtonElement) => element.click());
}

async function linkFrom(site: Page, selector: string): Promise<string> {
  const href = await site.locator(selector).getAttribute('href');
  if (!href) throw new Error('练习页缺少链接 ' + selector);
  return new URL(href, site.url()).href;
}

async function waitForEvidence(worker: Worker, kind: string, side?: string): Promise<void> {
  // Navigation can finish before the content script's reply is committed.
  // Wait for the observation to reach the same storage used by the extension.
  await expect.poll(() => worker.evaluate(async ({ kind, side }) => {
    const api = globalThis as typeof globalThis & {
      chrome: { storage: { session: { get(keys: null): Promise<Record<string, {
        observations?: { kind: string; status: string; invalidatedReason: string | null; payload: { side?: string } }[];
      }>> } } };
    };
    const entries = await api.chrome.storage.session.get(null);
    return Object.values(entries).some(item => item.observations?.some(observation =>
      observation.kind === kind && observation.status === 'ok' && !observation.invalidatedReason
      && (!side || observation.payload.side === side)));
  }, { kind, side }), { message: '等待扩展保存证据 ' + kind + (side ? ' ' + side : '') }).toBe(true);
}

test('在真实扩展中完成模拟协作，草稿与暂停不会产生成功结果', async ({ simulation: { site, panel, context } }) => {
  const worker = context.serviceWorkers()[0]!;
  const step = () => panel.getByTestId('step-title');
  const state = () => panel.getByTestId('session-state');
  await sidebar(site, panel, '开始练习');
  await expect(step()).toHaveText('认领任务');
  await expect(site.locator('#assign')).toHaveClass(/driver-active-element/);

  // Simulate a site replacing its own button during a redraw.
  const oldPopover = await site.locator('.webguide-popover').elementHandle();
  await site.locator('#assign').evaluate(element => {
    const replacement = document.createElement('button');
    replacement.id = element.id;
    replacement.textContent = element.textContent;
    element.replaceWith(replacement);
  });
  // The next check may highlight the new target before Playwright polls.
  // The old popover must still have been torn down before that can happen.
  await expect.poll(() => oldPopover.evaluate(element => element.isConnected)).toBe(false);
  await expect(site.locator('#assign')).toHaveClass(/driver-active-element/);

  await sidebar(site, panel, '暂停');
  await expect(state()).toHaveAttribute('data-state', 'paused');
  await expect(site.locator('#assign')).not.toHaveClass(/driver-active-element/);
  await sidebar(site, panel, '继续并重新核对');
  await expect(site.locator('#assign')).toHaveClass(/driver-active-element/);
  await site.locator('#assign').click();
  await expect(site.locator('#assignees')).toContainText('fixture-user');

  await site.locator('#open-repository').click();
  await site.locator('#branch-menu').click();
  await site.locator('#branch-name').fill('practice/first-pr-001');
  await site.locator('#create-branch').click();
  await expect(site.locator('#current-branch')).toHaveText('practice/first-pr-001');

  await site.locator('#open-file').click();
  const editableFile = site.url();
  await site.locator('#edit-file').click();
  const expected = await panel.getByTestId('expected-edit').innerText();
  await site.locator('#document-editor').fill(expected + '\n');
  await expect(panel.getByTestId('result')).toHaveCount(0);
  await expect(site).toHaveURL(/\/editor\?/);

  await site.locator('#open-commit').click();
  await site.locator('#commit-message').fill('完成模拟协作练习');
  await site.locator('#confirm-commit').click();
  await expect(site.locator('#commit-summary')).toHaveText('已保存提交');
  const baseFile = new URL(await linkFrom(site, '#base-source'));
  // 第二个练习端口共用仓库，但浏览器把它视为另一个来源。
  baseFile.port = '43132';
  const headFile = await linkFrom(site, '#head-source');
  const comparison = await linkFrom(site, '#open-comparison');
  await waitForEvidence(worker, 'fixture.commit');
  await site.goto(baseFile.href);
  await expect(site.locator('#source')).toContainText('待补充');
  await waitForEvidence(worker, 'fixture.file', 'base');
  await site.goto(headFile);
  await expect(site.locator('#source')).toContainText(expected);
  await waitForEvidence(worker, 'fixture.file', 'head');
  try {
    await sidebar(site, panel, '确认这次提交');
  } catch (error) {
    const diagnostic = await worker.evaluate(async () => {
      const api = globalThis as typeof globalThis & { chrome: { storage: { session: { get(keys: null): Promise<Record<string, unknown>> } } } };
      return api.chrome.storage.session.get(null);
    });
    await test.info().attach('协作检查点', { body: JSON.stringify(diagnostic, null, 2), contentType: 'application/json' });
    throw error;
  }
  await site.goto(comparison);

  await site.locator('#pr-title').fill('更新练习说明');
  await site.locator('#pr-body').fill('对应练习任务 #1');
  await site.locator('input[name=draft]').check();
  await site.locator('#create-pr').click();
  await expect(site.locator('#pr-number')).toHaveText('1');
  const pullRequest = site.url();
  const prFiles = await linkFrom(site, '#pr-files');
  const prCommits = await linkFrom(site, '#pr-commits');
  await waitForEvidence(worker, 'fixture.pr');
  await site.goto(prFiles);
  await waitForEvidence(worker, 'fixture.diff');
  await site.goto(prCommits);
  await waitForEvidence(worker, 'fixture.pr-commits');
  await site.goto(pullRequest);
  await expect(panel.getByTestId('result')).toHaveCount(0);

  await site.locator('#ready-review').click();
  await expect(panel.getByTestId('result')).toHaveText('开发模拟提交已验证');
  await expect(state()).toHaveAttribute('data-state', 'ended');
  expect(editableFile).toContain('docs%2Fpractice%2Ffirst-pr.md');
});
