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
      return { kind: 'keep', proofs: [{ index: 0, checks: [{ id: archived.id, field: 'checked', equals: true }] }] };
    }
    if (archived) return input.feedback
      ? { kind: 'highlight', instruction: '勾选 Archived', targetId: archived.id }
      : { kind: 'keep', proofs: [{ index: 0, checks: [{ id: input.page.nodes.find(node => node.label === 'Filter')!.id,
        field: 'expanded', equals: true }] }] };
    const reports = input.reads.flatMap(read => read.nodes).find(node => node.label === 'Reports');
    return reports
      ? { kind: 'highlight', instruction: '打开 Reports', targetId: reports.id }
      : { kind: 'observe', queries: [{ type: 'search', query: 'Reports' }, { type: 'search', query: 'Archived' }],
        requirements: [{ quote: goal, result: '已显示归档记录', source: 'page' }] };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route(pageOrigin + '/**', async route => {
      const body = new URL(route.request().url()).pathname === '/reports'
        ? '<h1>Reports</h1><button aria-expanded="true">Filter</button><label><input type="checkbox" aria-label="Archived"> Archived</label>'
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
    await expect(panel.getByRole('status')).toHaveText('已完成。已显示归档记录。');
    await expect(site.locator('.webguide-popover')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('入口证明有冲突时重新核对，正确高亮后自动收起', async ({ extension: { panel, activate } }) => {
  const siteUrl = 'https://workspace.example/export';
  const token = 'webguide-test-token-000000';
  const replies: GuideRequest[] = [];
  const app = createApp({ token, origins: [panel.url().replace('/sidepanel.html', '')], async decide(input) {
    replies.push(input);
    const target = input.page.nodes.find(node => node.label === 'Export')!;
    const context = input.page.nodes.find(node => node.label === 'Selected design')!;
    const proof = { index: 0, targetId: target.id, checks: [{ id: target.id, field: 'label', equals: 'Export' }] };
    if (input.feedback?.includes('多个控件')) return { kind: 'keep', proofs: [proof] };
    return { kind: 'highlight', targetId: target.id, instruction: '这里是导出按钮。',
      requirements: [{ quote: '请找到导出入口', result: '找到导出入口', source: 'point' }],
      proofs: [proof, { index: 0, targetId: context.id,
        checks: [{ id: context.id, field: 'label', equals: context.label }] }],
    };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route(siteUrl, route => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><main><button>Selected design</button><button>Export</button></main>' }));
    const site = await context.newPage();
    await site.goto(siteUrl);
    await site.bringToFront();
    await activate(site);
    await panel.getByLabel('我想做什么').fill('请找到导出入口');
    await panel.getByLabel('本机访问令牌').fill(token);
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());

    await expect(site.getByRole('button', { name: 'Export' })).toHaveClass(/driver-active-element/);
    await expect(site.locator('.webguide-popover')).toContainText('已找到');
    await expect(panel.getByRole('status')).toHaveText('已完成。找到导出入口。');
    expect(replies).toHaveLength(2);
    await expect(site.locator('.webguide-popover')).toHaveCount(0, { timeout: 6_000 });
  } finally {
    await app.close();
  }
});

test('当前选择可由收起的控件摘要确认', async ({ extension: { panel, activate } }) => {
  const siteUrl = 'https://workspace.example/visibility';
  const token = 'webguide-test-token-000000';
  const goal = '确认当前可见范围只限团队';
  const summary = 'Visibility: Team only';
  const app = createApp({ token, origins: [panel.url().replace('/sidepanel.html', '')], async decide(input) {
    const chooser = input.page.nodes.find(node => node.label === summary)!;
    if (input.feedback) return { kind: 'highlight', targetId: chooser.id, instruction: '收起可见范围菜单。' };
    return { kind: 'keep', requirements: [{ quote: goal, result: '可见范围只限团队', source: 'page' }],
      proofs: [{ index: 0, checks: [{ id: chooser.id, field: 'label', equals: summary }] }] };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route(siteUrl, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><main>'
      + '<button aria-expanded="true" onclick="this.setAttribute(\'aria-expanded\', \'false\')">' + summary + '</button>'
      + '</main>' }));
    const site = await context.newPage();
    await site.goto(siteUrl);
    await site.bringToFront();
    await activate(site);
    await panel.getByLabel('我想做什么').fill(goal);
    await panel.getByLabel('本机访问令牌').fill(token);
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());

    const chooser = site.getByRole('button', { name: summary });
    await expect(panel.getByRole('status')).toHaveText('收起可见范围菜单。');
    await expect(chooser).toHaveAttribute('aria-expanded', 'true');
    await chooser.click();
    await expect(chooser).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.getByRole('status')).toHaveText('已完成。可见范围只限团队。');
    await expect(site.locator('.webguide-popover')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('关联标签上的可见控件可以高亮并核对单选状态', async ({ extension: { panel, activate } }) => {
  const url = 'https://workspace.example/appearance';
  const token = 'webguide-test-token-000000';
  const goal = '把字号调到大号';
  const app = createApp({ token, origins: [panel.url().replace('/sidepanel.html', '')], async decide(input) {
    const large = input.page.nodes.find(node => node.role === 'radio' && node.label === 'Large');
    if (large?.checked) return { kind: 'keep',
      proofs: [{ index: 0, checks: [{ id: large.id, field: 'checked', equals: true }] }],
    };
    const target = large ?? input.page.nodes.find(node => node.role === 'button' && node.label === 'Appearance');
    if (target) return { kind: 'highlight', targetId: target.id, instruction: target.label,
      requirements: [{ quote: goal, source: 'page', result: '已调到大号' }],
    };
    return { kind: 'blocked', instruction: '没有可点击的字号设置。' };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route(url, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <style>
        label { display: inline-block; padding: 12px; }
        input { opacity: 0; position: absolute; }
        #appearance { inset: 0; width: 100%; height: 100%; margin: 0; }
        .trigger { position: relative; display: inline-block; }
        main:has(#appearance:not(:checked)) fieldset { display: none; }
      </style>
      <main>
        <span class="trigger">
          <label aria-hidden="true" for="appearance">Appearance</label>
          <input type="checkbox" role="button" aria-label="Appearance" id="appearance">
        </span>
        <fieldset>
          <input type="radio" name="size" id="standard" checked><label for="standard">Standard</label>
          <input type="radio" name="size" id="large"><label for="large">Large</label>
        </fieldset>
      </main>` }));
    const site = await context.newPage();
    await site.goto(url);
    await site.bringToFront();
    await activate(site);
    await panel.getByLabel('我想做什么').fill(goal);
    await panel.getByLabel('本机访问令牌').fill(token);
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());

    const appearance = site.locator('label[for="appearance"]');
    await expect(appearance).toHaveClass(/driver-active-element/);
    // 可见图标上方的透明输入控件会直接接到用户点击。
    await site.locator('#appearance').click();
    const large = site.locator('label[for="large"]');
    await expect(large).toHaveClass(/driver-active-element/);
    await large.click();
    await expect(site.locator('#large')).toBeChecked();
    await expect(panel.getByRole('status')).toHaveText('已完成。已调到大号。');
    await expect(site.locator('.webguide-popover')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('网页报告导出成功后，由用户单独确认已经下载', async ({ extension: { panel, activate } }) => {
  const siteUrl = 'https://workspace.example/download';
  const token = 'webguide-test-token-000000';
  const calls: GuideRequest[] = [];
  const app = createApp({ token, origins: [panel.url().replace('/sidepanel.html', '')], async decide(input) {
    calls.push(input);
    const node = input.page.nodes.find(node => node.role === 'status')!;
    const checks = [{ id: node.id, field: 'label', equals: node.label }];
    return { kind: 'keep', requirements: [
      { quote: '确认导出成功', result: '网页已导出', source: 'page' },
      { quote: '并且已下载到电脑', result: '文件已下载到电脑', source: 'user' },
    ], proofs: [{ index: 0, checks }, { index: 1, checks }] };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route(siteUrl, route => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><main><p role="status">Export succeeded. File downloaded to your computer.</p></main>' }));
    const site = await context.newPage();
    await site.goto(siteUrl);
    await site.bringToFront();
    await activate(site);
    await panel.getByLabel('我想做什么').fill('确认导出成功并且已下载到电脑');
    await panel.getByLabel('本机访问令牌').fill(token);
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());

    await expect(panel.getByRole('status')).toContainText('请确认下面这项结果');
    await expect(panel.getByText('文件已下载到电脑', { exact: true })).toBeVisible();
    const confirmation = panel.getByRole('button', { name: '确认这项已完成' });
    await confirmation.evaluate(button => (button as HTMLButtonElement).click());
    await expect(panel.getByRole('status')).toHaveText('已完成。网页已导出，文件已下载到电脑（由你确认）。');
    await expect(confirmation).toHaveCount(0);
    expect(calls).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test('有临时授权但缺少侧栏绑定记录时，可以恢复当前页引导', async ({ extension: { panel, activate } }) => {
  const url = 'https://workspace.example/toolbar';
  const token = 'webguide-test-token-000000';
  const calls: GuideRequest[] = [];
  const app = createApp({ token, origins: [panel.url().replace('/sidepanel.html', '')], async decide(input) {
    calls.push(input);
    const target = input.page.nodes.find(node => node.label === 'Settings')!;
    return { kind: 'highlight', instruction: '打开 Settings', targetId: target.id };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route(url, route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><main><button>Settings</button></main>',
    }));
    const site = await context.newPage();
    await site.goto(url);
    await panel.getByLabel('我想做什么').fill('找到当前页的设置入口');
    await panel.getByLabel('本机访问令牌').fill(token);
    await site.bringToFront();
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(panel.getByRole('status')).toContainText('先在目标网页点击');
    expect(calls).toHaveLength(0);

    await activate(site);
    const removed = await panel.evaluate(async () => {
      const extension = (globalThis as typeof globalThis & {
        chrome: {
          windows: { getCurrent(): Promise<{ id: number }> };
          storage: { session: { get(key: string): Promise<Record<string, unknown>>; remove(key: string): Promise<void> } };
        };
      }).chrome;
      const { id } = await extension.windows.getCurrent();
      const key = 'tool-tab:' + id;
      const storage = extension.storage.session;
      for (let count = 0; count < 20; count++) {
        if ((await storage.get(key))[key]) {
          await storage.remove(key);
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      return false;
    });
    expect(removed).toBe(true);
    await panel.getByRole('button', { name: '继续引导' }).evaluate(button => (button as HTMLButtonElement).click());
    await expect(site.getByRole('button', { name: 'Settings' })).toHaveClass(/driver-active-element/);
    expect(calls).toHaveLength(1);
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
