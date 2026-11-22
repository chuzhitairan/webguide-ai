import { expect, test } from './fixtures.js';
import { createApp } from '../../apps/api/src/app.js';
import type { GuideRequest } from '../../apps/api/src/guide-protocol.js';

test('从自然语言目标出发补看控件、跟随同源跳转，并确认筛选生效', async ({ extension: { panel, activate } }) => {
  const pageOrigin = 'https://workspace.example';
  const token = 'webguide-test-token-000000';
  const goal = '打开报告并只显示已归档的记录';
  const calls: GuideRequest[] = [];
  const app = createApp({ token, origins: [panel.url().replace('/sidepanel.html', '')], async decide(input) {
    calls.push(input);
    const archived = input.page.nodes.find(node => node.label === 'Archived');
    if (archived?.checked) {
      return { kind: 'complete', instruction: '已显示归档记录', checks: [{ id: archived.id, field: 'checked', equals: true }] };
    }
    if (archived) return input.feedback
      ? { kind: 'highlight', instruction: '勾选 Archived', targetId: archived.id }
      : { kind: 'complete', instruction: '错误：归档筛选已生效', checks: [{ id: archived.id, field: 'available', equals: true }] };
    const reports = input.reads.flatMap(read => read.nodes).find(node => node.label === 'Reports');
    return reports
      ? { kind: 'highlight', instruction: '打开 Reports', targetId: reports.id }
      : { kind: 'observe', queries: [{ type: 'search', query: 'Reports' }, { type: 'search', query: 'Archived' }] };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route(pageOrigin + '/**', async route => {
      const body = new URL(route.request().url()).pathname === '/reports'
        ? '<h1>Reports</h1><label><input type="checkbox" aria-label="Archived"> Archived</label>'
        : '<h1>Workspace</h1><div style="display:grid;grid-template-columns:repeat(6, 100px)">'
          + Array.from({ length: 50 }, (_, index) => '<button>Tool ' + index + '</button>').join('')
          + '</div><a href="/reports">Reports</a>';
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><main>' + body + '</main>' });
    });
    const site = await context.newPage();
    await site.goto(pageOrigin);
    await site.bringToFront();
    await activate(site);
    await panel.getByLabel('我想做什么').fill(goal);
    await panel.getByLabel('本机访问令牌').fill(token);
    await site.bringToFront();
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());

    const reports = site.getByRole('link', { name: 'Reports' });
    await expect(reports).toHaveClass(/driver-active-element/);
    await expect(site).toHaveURL(pageOrigin + '/');
    expect(calls[0].page.nodes.some(node => node.label === 'Reports')).toBe(false);
    expect(calls[1].reads).toHaveLength(2);
    expect(calls.every(call => call.goal === goal)).toBe(true);

    await reports.click();
    const archived = site.getByRole('checkbox', { name: 'Archived' });
    await expect(archived).toHaveClass(/driver-active-element/);
    await expect(archived).not.toBeChecked();
    await expect(panel.getByRole('status')).toHaveText('勾选 Archived');
    expect(calls.some(call => call.feedback?.includes('完成证据'))).toBe(true);
    await archived.check();
    await expect(panel.getByRole('status')).toHaveText('已显示归档记录');
    await expect(site.locator('.webguide-popover')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('属性栏按钮没变时，选中对象变化也会使在途回复失效', async ({ extension: { panel, activate } }) => {
  const url = 'https://workspace.example/design';
  const token = 'webguide-test-token-000000';
  let started!: () => void;
  let release!: () => void;
  const firstRequest = new Promise<void>(resolve => { started = resolve; });
  const slow = new Promise<void>(resolve => { release = resolve; });
  const app = createApp({ token, origins: [panel.url().replace('/sidepanel.html', '')], async decide(input) {
    const target = input.page.nodes.find(node => node.label === 'Export')!;
    const selected = input.page.nodes.find(node => node.selected)?.label;
    if (selected === 'Layer A') {
      started();
      await slow;
    }
    return { kind: 'highlight', targetId: target.id, instruction: 'Export ' + selected };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route(url, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>'
      + '<main><div role="tree"><div role="treeitem" aria-selected="true">Layer A</div>'
      + '<div role="treeitem" aria-selected="false">Layer B</div></div><button>Export</button></main>' }));
    const site = await context.newPage();
    await site.goto(url);
    await site.evaluate(() => {
      new MutationObserver(() => {
        if (document.querySelector('.webguide-popover')?.textContent?.includes('Export Layer A')) {
          document.body.dataset.staleGuide = 'shown';
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await site.bringToFront();
    await activate(site);
    await panel.getByLabel('我想做什么').fill('找到当前选中对象的导出按钮');
    await panel.getByLabel('本机访问令牌').fill(token);
    await site.bringToFront();
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await firstRequest;

    await site.evaluate(() => {
      const [a, b] = document.querySelectorAll('[role="treeitem"]');
      a.setAttribute('aria-selected', 'false');
      b.setAttribute('aria-selected', 'true');
    });
    release();
    await expect(panel.getByRole('status')).toHaveText('Export Layer B');
    await expect(site.locator('.webguide-popover')).toContainText('Export Layer B');
    await expect(site.locator('body')).not.toHaveAttribute('data-stale-guide', 'shown');

    // 销毁侧栏页面会关闭旧端口，目标通过浏览器会话存储恢复。
    const panelUrl = panel.url();
    await panel.goto('about:blank');
    await expect(site.locator('.webguide-popover')).toHaveCount(0);
    await panel.goto(panelUrl);
    await expect(panel.getByLabel('我想做什么')).toHaveValue('找到当前选中对象的导出按钮');
    await expect(panel.getByRole('button', { name: '继续引导' })).toBeVisible();
  } finally {
    release();
    await app.close();
  }
});
