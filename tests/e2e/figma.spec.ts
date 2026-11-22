import { expect, test } from './fixtures.js';
import { createApp } from '../../apps/api/src/app.js';

test('Figma guidance follows layer selection and points to the layout heading', async ({ extensionPages: { panel, grantAccess } }) => {
  const file = 'https://www.figma.com/design/Practice123/Practice';
  const token = 'navigation-figma-e2e-token';
  const seenTargets: string[][] = [];
  const seenPages: string[][] = [];
  const origin = panel.url().replace('/sidepanel.html', '');
  const app = createApp({ clientToken: token, origins: [origin], async choose({ page }) {
    seenTargets.push(page.controls.map(control => control.label));
    seenPages.push([page.path, page.title]);
    const target = page.controls.find(control => control.label === 'Toggle auto layout'
      || control.role === 'heading' || control.role === 'row');
    if (!target) return { kind: 'message', instruction: '没有找到相关控件。' };
    const instruction = target.label === 'Toggle auto layout' ? '高亮处是启用自动布局的开关。'
      : target.role === 'heading' ? '在右侧查看 Auto layout。' : '在左侧选择 Frame 1。';
    return { kind: 'highlight', targetId: target.id, instruction };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route(file, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <title>Practice file</title>
      <style>
        body { margin: 0; }
        section { position: fixed; width: 260px; top: 0; bottom: 0; }
        section[aria-label="Left sidebar"] { left: 0; }
        section[aria-label="Right sidebar"] { right: 0; }
        section button, [role="row"] { box-sizing: border-box; width: 100%; padding: 8px; }
        #layout-toggle { position: relative; width: 24px; height: 24px; }
        #layout-toggle input, #layout-toggle label { position: absolute; inset: 0; margin: 0; }
        #layout-toggle input { width: 100%; height: 100%; opacity: 0; }
        #layout-toggle label { pointer-events: none; }
      </style>
      <section aria-label="Left sidebar">
        <button>Layers</button>
        <div role="treegrid">
          <div role="row" data-testid="layer-row" aria-selected="false">
            <div role="gridcell" aria-colindex="1"><svg aria-hidden="true" width="16" height="16"></svg></div>
            <div role="gridcell" aria-colindex="1">Frame 1</div>
          </div>
          <div role="row" data-testid="layer-row" aria-selected="true">
            <div role="gridcell" aria-colindex="1">Another frame</div>
          </div>
        </div>
      </section>
      <section aria-label="Right sidebar">
        <h2>Auto layout</h2>
        <div id="layout-toggle" hidden>
          <input id="use-auto-layout" type="checkbox" data-tooltip="Use auto layout">
          <label for="use-auto-layout"><svg aria-hidden="true" width="24" height="24"></svg><span style="position: absolute; clip-path: inset(100%)">Toggle auto layout</span></label>
        </div>
      </section>
      <script>
        const [frame, other] = document.querySelectorAll('[role="row"]');
        frame.addEventListener('click', () => {
          other.setAttribute('aria-selected', 'false');
          frame.setAttribute('aria-selected', 'true');
          history.replaceState(null, '', '?node-id=1-2');
        });
      </script>` }));
    const site = await context.newPage();
    await site.goto(file);
    await site.bringToFront();
    await grantAccess(site);
    await panel.getByLabel('引导目标').selectOption('figma-auto-layout', { timeout: 4000 });
    await panel.getByLabel('本机访问令牌').fill(token);
    await site.bringToFront();
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());

    const layer = site.getByRole('row', { name: 'Frame 1' });
    const layout = site.getByRole('heading', { name: 'Auto layout' });
    const popover = site.locator('.webguide-popover');
    await expect(layer).toHaveClass(/driver-active-element/);
    await expect(layer).toHaveAttribute('aria-selected', 'false');
    await expect(layout).not.toHaveClass(/driver-active-element/);

    // 提示应放在图层栏之外，给正在操作的图层及相邻图层留出空间。
    await expect(popover).toBeVisible();
    const sidebar = site.getByRole('region', { name: 'Left sidebar' });
    expect((await popover.boundingBox())!.x).toBeGreaterThanOrEqual((await sidebar.boundingBox())!.width);
    await site.setViewportSize({ width: 380, height: 720 });
    await expect(popover).toBeHidden();
    await expect(panel.getByRole('status')).toHaveText('在左侧选择 Frame 1。');
    await site.setViewportSize({ width: 1280, height: 720 });
    await expect(popover).toBeVisible();

    await site.evaluate(() => history.replaceState(null, '', '/design/Other456/Other'));
    await expect(panel.getByRole('status')).toHaveText('请回到本次引导的 Figma 设计稿。');
    await expect(layer).not.toHaveClass(/driver-active-element/);
    expect(seenTargets).toEqual([['Frame 1']]);
    await site.evaluate(() => history.replaceState(null, '', '/design/Practice123/Practice'));
    await expect(layer).toHaveClass(/driver-active-element/);

    await layer.getByRole('gridcell', { name: 'Frame 1' }).click();
    await expect(layout).toHaveClass(/driver-active-element/);
    await expect(panel.getByRole('status')).toHaveText('已找到自动布局。 在右侧查看 Auto layout。');
    await expect(popover).toHaveCount(0);
    await expect(layout).not.toHaveClass(/driver-active-element/);
    expect(site.url()).toBe(file + '?node-id=1-2');
    expect(seenTargets).toEqual([['Frame 1'], ['Frame 1'], ['Auto layout']]);

    // 复现 Figma 的透明原生控件和它旁边的可见图标，只有后者适合画高亮。
    await layout.evaluate(heading => {
      heading.textContent = 'Layout';
      heading.ownerDocument.getElementById('layout-toggle')!.hidden = false;
    });
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    const freeformLayout = site.getByRole('heading', { name: 'Layout', exact: true });
    const toggleIcon = site.locator('label[for="use-auto-layout"]');
    await expect(toggleIcon).toHaveClass(/driver-active-element/);
    await expect(freeformLayout).not.toHaveClass(/driver-active-element/);
    await expect(site.getByRole('checkbox', { name: 'Toggle auto layout' })).not.toBeChecked();
    const result = '已找到自动布局。 高亮处是启用自动布局的开关。';
    await expect(panel.getByRole('status')).toHaveText(result);
    await expect(panel.getByRole('button', { name: '停止' })).toHaveCount(0);
    await expect(popover).toHaveCount(0);
    await expect(toggleIcon).not.toHaveClass(/driver-active-element/);
    await expect(panel.getByRole('status')).toHaveText(result);
    expect(seenTargets.slice(3)).toEqual([['Toggle auto layout']]);
    expect(seenPages).toEqual(Array.from({ length: 4 }, () => ['/design', 'Figma Design']));
  } finally {
    await app.close();
  }
});
