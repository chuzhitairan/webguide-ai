import { expect, test } from './fixtures.js';
import { createApp } from '../../apps/api/src/app.js';
import type { GuideRequest } from '../../apps/api/src/guide-protocol.js';

test('按列表编号补看，扩展核对并高亮同一条目的链接', async ({ extension: { panel, activate } }) => {
  const url = 'https://workspace.example/requests';
  const token = 'webguide-test-token-000000';
  const goal = '帮我找到第 1 号申请的入口。';
  const app = createApp({ token, origins: [panel.url().replace('/sidepanel.html', '')], async decide(input) {
    if (!input.reads.length) {
      expect(input.page.nodes.some(node => node.label === 'First request')).toBe(false);
      return { kind: 'observe', queries: [{ type: 'search', query: '#1' }] };
    }
    const nodes = input.reads[0].nodes;
    const entry = nodes.find(node => node.role === 'listitem')!;
    const links = nodes.filter(node => node.role === 'link');
    expect(links).toEqual([expect.objectContaining({ label: 'First request', object: entry.id })]);
    return { kind: 'point', targetId: links[0].id, scopeId: entry.id,
      requirements: [{ quote: goal, result: '找到第 1 号申请入口', source: 'point' }] };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route(url, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><main>'
      + '<div style="display:grid;grid-template-columns:repeat(10,90px)">'
      + Array.from({ length: 42 }, (_, index) => `<button>Filter ${index + 50}</button>`).join('')
      + '</div><ul><li><span>#10</span><a href="/ten">Other request</a></li>'
      + '<li aria-label="More information"><h3 style="display:inline;overflow:hidden">'
      + '<a href="/one">First request</a></h3><span>#<!--split-->1</span></li></ul></main>' }));
    const page = await context.newPage();
    await page.goto(url);
    await page.bringToFront();
    await activate(page);
    await panel.getByLabel('我想做什么').fill(goal);
    await panel.getByLabel('本机访问令牌').fill(token);
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(panel.getByRole('status')).toHaveText('已完成。找到第 1 号申请入口。');
    await expect(page.getByRole('link', { name: 'First request' })).toHaveClass(/driver-active-element/);
    await expect(page).toHaveURL(url);
  } finally {
    await app.close();
  }
});

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
    const target = input.page.nodes.find(node => node.role === 'button' && node.label === 'Export')!;
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
      body: '<!doctype html><main><button>Selected design</button>'
        + '<div role="treeitem" aria-label="Export"><button>Export</button></div></main>' }));
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

test('到达目标须核对实际界面，标题和其他区域的控件不足以完成', async ({ extension: { panel, activate } }) => {
  const origin = 'https://workspace.example';
  const token = 'webguide-test-token-000000';
  const goal = '请帮我打开「侧栏闪烁」的详情。';
  const title = '侧栏闪烁';
  const calls: GuideRequest[] = [];
  const app = createApp({ token, origins: [panel.url().replace('/sidepanel.html', '')], async decide(input) {
    calls.push(input);
    const link = input.page.nodes.find(node => node.role === 'link' && node.label === title);
    if (link) return { kind: 'highlight', targetId: link.id, instruction: '打开详情。',
      requirements: [{ start: null, result: '找到详情入口', source: 'point' }] };

    const heading = input.page.nodes.find(node => node.role === 'heading' && node.label === title)!;
    const checks = [{ id: heading.id, field: 'label', equals: title }];
    if (!input.feedback) return { kind: 'keep', proofs: [{ index: 0, checks }],
      requirements: [{ quote: goal, result: '已打开侧栏闪烁的详情', source: 'arrival' }] };

    // 连续测试标题、站点导航栏里的控件、详情区自己的控件。
    const label = calls.length === 3 ? '站点选项' : '留下评论';
    const control = input.page.nodes.find(node => node.label === label)!;
    return { kind: 'keep', proofs: [{ index: 0, checks: [...checks, { id: control.id, field: 'label', equals: label }] }] };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route(origin + '/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8',
      body: new URL(route.request().url()).pathname === '/'
        ? '<!doctype html><main><h1>问题列表</h1><a href="/details">侧栏闪烁</a></main>'
        : '<!doctype html><nav><button>站点选项</button></nav><main><h1>侧栏闪烁</h1><button>留下评论</button></main>' }));
    const site = await context.newPage();
    await site.goto(origin);
    const entry = site.getByRole('link', { name: title });
    await expect(entry).toBeVisible();
    await site.bringToFront();
    await activate(site);
    await panel.getByLabel('我想做什么').fill(goal);
    await panel.getByLabel('本机访问令牌').fill(token);
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());

    await expect(panel.getByRole('status')).toHaveText('打开详情。');
    await entry.click();
    await expect(panel.getByRole('status')).toHaveText('已完成。已打开侧栏闪烁的详情。');
    expect(calls).toHaveLength(4);
    expect(calls[1].requirements?.[0]).toMatchObject({ quote: goal, source: 'point' });
    expect(calls.slice(2).every(call => call.requirements?.[0].source === 'arrival'
      && call.feedback?.includes('到达证据未通过'))).toBe(true);
  } finally {
    await app.close();
  }
});

test('最终指引核对同名入口的区域，指到正确入口后直接完成', async ({ extension: { panel, activate } }) => {
  const url = 'https://workspace.example/export-scopes';
  const token = 'webguide-test-token-000000';
  const goal = '找到 Frame 1 的导出设置';
  const calls: GuideRequest[] = [];
  const app = createApp({ token, origins: [panel.url().replace('/sidepanel.html', '')], async decide(input) {
    calls.push(input);
    const region = input.page.nodes.find(node => node.label === 'Frame 1 properties')!;
    const pageTools = input.page.nodes.find(node => node.label === 'Page tools')!;
    const pageExport = input.page.nodes.find(node => node.label === 'Export settings' && node.region === pageTools.id)!;
    if (calls.length === 1) return { kind: 'highlight', targetId: pageExport.id, scopeId: pageTools.id, instruction: '点击导出设置。' };
    if (calls.length === 2) return { kind: 'point', targetId: pageExport.id, scopeId: region.id,
      requirements: [{ quote: goal, result: goal, source: 'point' }],
    };
    const target = input.page.nodes.find(node => node.label === 'Export settings' && node.id !== pageExport.id);
    if (!target) return { kind: 'message', instruction: '向下滚动 Frame 1 的属性面板。', scrollRegion: region.id };
    if (input.reads.length === 0) return { kind: 'observe', queries: [{ type: 'inspect', id: target.id }] };
    const owner = input.reads[0]?.nodes.find(node => node.id === region.id);
    if (!owner) return { kind: 'blocked', instruction: '还没有看到图层属性。' };
    return { kind: 'point', targetId: target.id, scopeId: owner.id };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route(url, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <style>main{display:flex;gap:40px} aside{height:180px;width:240px;overflow:auto}
        #export{margin-top:380px;margin-bottom:120px}</style>
      <main>
        <section aria-label="Page tools"><button id="page-export">Export settings</button>
          <button role="treeitem" aria-selected="true">Frame 1</button></section>
        <aside aria-label="Frame 1 properties" id="frame-properties">
          <section aria-label="Export" id="export"><button id="frame-export">Export settings</button></section>
        </aside>
      </main>` }));
    const site = await context.newPage();
    await site.goto(url);
    await site.bringToFront();
    await activate(site);
    await panel.getByLabel('我想做什么').fill(goal);
    await panel.getByLabel('本机访问令牌').fill(token);
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());

    const wrong = site.locator('#page-export');
    const target = site.locator('#frame-export');
    await expect(target).not.toBeInViewport();
    await expect(panel.getByRole('status')).toHaveText('向下滚动 Frame 1 的属性面板。');
    await expect(wrong).not.toHaveClass(/driver-active-element/);
    expect(calls).toHaveLength(3);
    expect(calls.slice(1, 3).every(call => call.feedback?.includes('同名'))).toBe(true);
    const region = site.locator('#frame-properties');
    await region.hover();
    await site.mouse.wheel(0, 400);
    await expect(target).toBeInViewport();
    await expect(target).toHaveClass(/driver-active-element/);
    await expect(panel.getByRole('status')).toHaveText('已完成。找到 Frame 1 的导出设置。');
    expect(calls).toHaveLength(5);
    await expect(wrong).not.toHaveClass(/driver-active-element/);
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

test('操作后优先复查首读范围外的单选控件', async ({ extension: { panel, activate } }) => {
  const url = 'https://workspace.example/appearance';
  const token = 'webguide-test-token-000000';
  const goal = '把字号调到大号';
  const calls: GuideRequest[] = [];
  const app = createApp({ token, origins: [panel.url().replace('/sidepanel.html', '')], async decide(input) {
    calls.push(input);
    const large = [...input.page.nodes, ...input.reads.flatMap(read => read.nodes)]
      .find(node => node.role === 'radio' && node.label === 'Large');
    if (large?.checked) return { kind: 'keep',
      proofs: [{ index: 0, checks: [{ id: large.id, field: 'checked', equals: true }] }],
    };
    const trigger = input.page.nodes.find(node => node.role === 'button' && node.label === 'Appearance');
    if (trigger?.expanded && !large) return { kind: 'observe', queries: [{ type: 'search', query: 'Large' }] };
    const target = large ?? trigger;
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
        .tools { display: grid; grid-template-columns: repeat(10, 85px); }
        main:has(#appearance:not(:checked)) fieldset { display: none; }
      </style>
      <main>
        <span class="trigger">
          <label aria-hidden="true" for="appearance">Appearance</label>
          <input type="checkbox" role="button" aria-label="Appearance" aria-expanded="false" id="appearance"
            onchange="this.setAttribute('aria-expanded', String(this.checked))">
        </span>
        <fieldset>
          <div class="tools">${Array.from({ length: 45 }, (_, index) => '<button>Tool ' + index + '</button>').join('')}</div>
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
    expect(calls.at(-1)?.page.nodes.some(node => node.label === 'Large')).toBe(false);
    expect(calls.at(-1)?.reads.flatMap(read => read.nodes)).toContainEqual(
      expect.objectContaining({ label: 'Large', checked: false }),
    );
    const beforeClick = calls.length;
    await large.click();
    await expect(site.locator('#large')).toBeChecked();
    await expect(panel.getByRole('status')).toHaveText('已完成。已调到大号。');
    await expect(site.locator('.webguide-popover')).toHaveCount(0);
    expect(calls.slice(beforeClick)).toHaveLength(1);
    expect(calls[beforeClick]?.reads).toEqual([]);
    expect(calls[beforeClick]?.page.nodes[0]).toMatchObject({ label: 'Large', checked: true });
    expect(calls[beforeClick]?.page.nodes).toHaveLength(40);
  } finally {
    await app.close();
  }
});

test('文字提示之后滚动面板，即使没有区域编号也会重新观察', async ({ extension: { panel, activate } }) => {
  const url = 'https://workspace.example/scroll-settings';
  const token = 'webguide-test-token-000000';
  const goal = '找到发布设置入口';
  const calls: GuideRequest[] = [];
  const app = createApp({ token, origins: [panel.url().replace('/sidepanel.html', '')], async decide(input) {
    calls.push(input);
    if (calls.length === 1) return { kind: 'message', instruction: '向下滚动属性面板。',
      requirements: [{ quote: goal, source: 'point', result: goal }] };

    const target = input.reads.flatMap(read => read.nodes).find(node => node.label === '发布设置');
    if (!target?.viewport) return { kind: 'observe', queries: [{ type: 'search', query: '发布设置' }] };
    return { kind: 'keep', proofs: [{ index: 0, targetId: target.id,
      checks: [{ id: target.id, field: 'label', equals: target.label }] }] };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route(url, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html>
      <style>
        main { display: flex; gap: 24px; }
        #tools { display: grid; grid-template-columns: repeat(8, 70px); }
        #settings { height: 200px; width: 250px; overflow-y: auto; }
        .spacer { height: 530px; }
      </style>
      <main>
        <div id="tools">${Array.from({ length: 45 }, (_, index) => '<button>Tool ' + index + '</button>').join('')}</div>
        <section id="settings" aria-label="属性面板">
          <div class="spacer"></div><button>发布设置</button><div class="spacer"></div>
        </section>
      </main>` }));
    const site = await context.newPage();
    await site.goto(url);
    const settings = site.locator('#settings');
    await settings.evaluate(element => { element.scrollTop = 40; });
    await site.bringToFront();
    await activate(site);
    await panel.getByLabel('我想做什么').fill(goal);
    await panel.getByLabel('本机访问令牌').fill(token);
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());

    await expect(panel.getByRole('status')).toHaveText('向下滚动属性面板。');
    await settings.hover();
    await site.mouse.wheel(0, 460);
    await expect.poll(() => settings.evaluate(element => element.scrollTop)).toBeGreaterThan(440);
    const target = site.getByRole('button', { name: '发布设置' });
    await expect(target).toBeInViewport();
    await expect(target).toHaveClass(/driver-active-element/);
    await expect(panel.getByRole('status')).toHaveText('已完成。找到发布设置入口。');
    // 滚动区域的方向标志和首读列表都没变。新控件由补看找出。
    expect(calls[1]?.page).toEqual(calls[0]?.page);
    expect(calls).toHaveLength(3);
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
