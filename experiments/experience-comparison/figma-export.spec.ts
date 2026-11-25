import { writeFile } from 'node:fs/promises';
import { createApp } from '../../apps/api/src/app.js';
import { readGuideConfig } from '../../apps/api/src/config.js';
import { loadExperienceCatalog } from '../../apps/api/src/experience.js';
import { createModelGuide, validateDecision } from '../../apps/api/src/guide.js';
import type { GuideRequest } from '../../apps/api/src/guide-protocol.js';
import { expect, test } from '../../tests/e2e/fixtures.js';

const address = 'https://www.figma.com/design/webguide-pilot/experience-comparison';
const token = 'webguide-experience-comparison-local';
const goal = '我想把 Frame 1 导出成图片，先帮我找到它的导出设置入口。';

function pageHtml(selected: boolean) {
  // 两个同名按钮分属页面和图层。选中 Frame 1 后才显示图层的属性面板。
  return `<!doctype html><title>Design exercise</title>
    <style>
      body { font: 16px sans-serif; margin: 20px; }
      main { display: grid; grid-template-columns: 220px 1fr 300px; gap: 24px; }
      button { padding: 6px 10px; margin-block: 4px; }
      #design { height: 350px; overflow: auto; border: 1px solid #888; padding-inline: 12px; }
      #design[hidden] { display: none; }
      .property { height: 66px; }
    </style>
    <main>
      <aside aria-label="Left sidebar">
        <div role="tree" aria-label="Layers">
          <button id="frame" role="treeitem" aria-selected="${selected}">Frame 1</button>
          <button id="cover" role="treeitem" aria-selected="false">Cover</button>
        </div>
        <section aria-label="Page export">
          <h2>Export</h2><button id="page-export" aria-label="Add export settings">+</button>
        </section>
      </aside>
      <section aria-label="Canvas"><h1>Design exercise</h1></section>
      <aside id="design" aria-label="Design properties" ${selected ? '' : 'hidden'}>
        <h2>Design</h2><h3>Frame 1 properties</h3>
        ${['Position', 'Layout', 'Constraints', 'Appearance', 'Fill', 'Stroke', 'Effects', 'Selection colors']
          .map(name => '<div class="property"><button>' + name + '</button></div>').join('')}
        <section aria-label="Export">
          <h2>Export</h2><button id="frame-export" aria-label="Add export settings">+</button>
        </section>
      </aside>
    </main>
    <script>
      document.querySelector('#frame').addEventListener('click', event => {
        event.currentTarget.setAttribute('aria-selected', 'true');
        document.querySelector('#design').hidden = false;
      });
    </script>`;
}

test('capture post-scroll observation', async ({ extension: { panel, activate } }, testInfo) => {
  const scrollInstruction = '在右侧设计面板向下滚动，找到 Export 区域，点击其中的 Add export settings 打开导出设置。';
  let captured: GuideRequest | undefined;
  const app = createApp({ token, origins: [panel.url().replace('/sidepanel.html', '')], async decide(input) {
    if (!input.previous) return { kind: 'message', instruction: scrollInstruction };
    if (input.reads.length === 0) {
      return { kind: 'observe', queries: [{ type: 'search', query: 'Add export settings' }] };
    }
    captured ??= input;
    return { kind: 'keep' };
  } });
  await app.listen({ host: '127.0.0.1', port: 43130 });
  try {
    const context = panel.context();
    await context.route(address, route => route.fulfill({ contentType: 'text/html', body: pageHtml(true) }));
    const site = await context.newPage();
    await site.setViewportSize({ width: 1120, height: 720 });
    await site.goto(address);
    const target = site.locator('#frame-export');
    await expect(target).not.toBeInViewport();
    await panel.getByLabel('我想做什么').fill(goal);
    await panel.getByLabel('本机访问令牌').fill(token);
    await site.bringToFront();
    await activate(site);
    await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(panel.getByRole('status')).toHaveText(scrollInstruction);

    await site.locator('#design').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(target).toBeInViewport();
    await expect.poll(() => captured?.previous?.instruction).toBe(scrollInstruction);
    await writeFile(testInfo.outputPath('post-scroll-observation.json'), JSON.stringify({ input: captured }));
  } finally {
    await app.close();
  }
});

for (let pair = 1; pair <= 3; pair++) {
  for (const selected of [false, true]) {
    // 相邻试跑只切换经验开关。交替先后顺序，降低服务随时间变化的影响。
    const order = (pair + Number(selected)) % 2 === 1 ? [false, true] : [true, false];
    for (const withExperience of order) {
      const start = selected ? 'selected-offscreen' : 'unselected';
      const mode = withExperience ? 'on' : 'off';
      test(`${start} pair ${pair} ${mode}`, async ({ extension: { panel, activate } }, testInfo) => {
        process.loadEnvFile('apps/api/.env');
        const local = readGuideConfig(process.env);
        if (!local) throw new Error('请先配置本机模型。');
        const decide = createModelGuide(local.model);
        const catalog = withExperience ? loadExperienceCatalog() : undefined;
        const context = panel.context();
        await context.route(address, route => route.fulfill({ contentType: 'text/html', body: pageHtml(selected) }));
        const site = await context.newPage();
        await site.setViewportSize({ width: 1120, height: 720 });
        await site.goto(address);
        const target = site.locator('#frame-export');
        const frame = site.locator('#frame');
        const properties = site.locator('#design');
        await expect(frame).toHaveAttribute('aria-selected', String(selected));
        await expect(target).not.toBeInViewport();

        let requests = 0;
        let observations = 0;
        let pending = 0;
        let latestActivity = 0;
        const serviceOutcomes: string[] = [];
        const clientOutcomes: string[] = [];
        const decisions: Record<string, unknown>[] = [];
        let latestAccepted: { request: number; input: GuideRequest } | undefined;
        let firstCorrectInput: GuideRequest | undefined;
        let reachedAfter: number | null = null;
        panel.on('console', async message => {
          if (!message.text().startsWith('[guide]')) return;
          const data = await message.args()[1]?.jsonValue().catch(() => null);
          if (typeof data?.outcome === 'string') clientOutcomes.push(data.outcome);
        });
        const app = createApp({ token, origins: [panel.url().replace('/sidepanel.html', '')],
          catalog,
          async decide(input, signal, hints) {
            const request = ++requests;
            pending++;
            latestActivity = Date.now();
            try {
              const reply = await decide(input, signal, hints);
              const raw = reply && typeof reply === 'object'
                ? reply as { kind?: unknown; requirements?: unknown; proofs?: unknown } : undefined;
              const accepted = validateDecision(reply, input);
              if (raw?.kind === 'observe') observations++;
              if (accepted && !signal.aborted) latestAccepted = { request, input };
              decisions.push({ request, kind: raw?.kind, finishOnly: input.finishOnly, feedback: input.feedback,
                expectedResults: (accepted?.requirements ?? input.requirements)?.map(({ source }) => source),
                submittedConditions: Array.isArray(raw?.requirements) ? raw.requirements.length : 0,
                submittedProofs: Array.isArray(raw?.proofs) ? raw.proofs.length : 0,
                acceptedProofs: accepted?.proofs?.length ?? 0,
                accepted: !!accepted });
              return reply;
            } finally {
              pending--;
              latestActivity = Date.now();
            }
          },
        }, ({ outcome }) => { if (outcome !== 'ok') serviceOutcomes.push(outcome); });
        await app.listen({ host: '127.0.0.1', port: 43130 });
        try {
          await panel.getByLabel('我想做什么').fill(goal);
          await panel.getByLabel('本机访问令牌').fill(token);
          await site.bringToFront();
          await activate(site);
          const started = Date.now();
          await panel.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
          latestActivity = started;
          const highlights = new Set<string>();
          let reachedMs: number | null = null;
          let layerSelected = selected;
          let scrollTop = 0;
          let status = '';
          let stop = 'trial-deadline';
          let lastHighlight = '';

          while (Date.now() - started < 105_000) {
            status = await panel.getByRole('status').textContent() ?? '';
            const highlight = await site.evaluate(() => {
              const element = document.querySelector('.driver-active-element');
              return element?.id || element?.getAttribute('aria-label') || element?.textContent?.trim().slice(0, 64) || '';
            });
            if (highlight) {
              highlights.add(highlight);
              lastHighlight = highlight;
            }
            if (highlight === 'frame-export' && reachedMs === null) {
              reachedMs = Date.now() - started;
              reachedAfter = latestAccepted?.request ?? null;
              firstCorrectInput = latestAccepted?.input;
            }
            if (status.startsWith('已完成')) { stop = 'completed'; break; }
            if (await panel.getByRole('button', { name: '继续引导' }).isVisible()) { stop = 'paused'; break; }
            if (await panel.getByRole('button', { name: '回答并继续' }).isVisible()) { stop = 'asked'; break; }
            if (await panel.getByRole('button', { name: '确认这项已完成' }).isVisible()) { stop = 'asked-for-confirmation'; break; }

            // 模拟用户跟随已显示的步骤。脚本只选择图层和滚动属性面板。
            if (!layerSelected && (highlight === 'frame' || /(?:点击|选中|选择)\s*[「『“"\x60]?\s*Frame 1/i.test(status))) {
              await frame.click();
              await expect(frame).toHaveAttribute('aria-selected', 'true');
              layerSelected = true;
              latestActivity = Date.now();
            }
            if (layerSelected && scrollTop === 0 && /滚动|下滑|往下|向下|scroll/i.test(status)
              && !/滚动.{0,6}(?:左侧|图层列表)/i.test(status)) {
              scrollTop = await properties.evaluate(element => {
                element.scrollTop = element.scrollHeight;
                return element.scrollTop;
              });
              expect(scrollTop).toBeGreaterThan(0);
              latestActivity = Date.now();
            }
            if (requests > 0 && pending === 0 && Date.now() - latestActivity > 4500) { stop = 'idle'; break; }
            await new Promise(resolve => setTimeout(resolve, 130));
          }
          const correctFinish = stop === 'completed' && lastHighlight === 'frame-export';
          // 固定页面的首个正确高亮可回放，同一份观察可用于对照两版提示词。
          if (firstCorrectInput) {
            await writeFile(testInfo.outputPath('first-correct-observation.json'), JSON.stringify({ input: firstCorrectInput, mode }));
          }
          // 这条日志是试跑结果。Playwright 通过表示试跑过程有效，导航结果由页面证据判定。
          console.log('EXPERIENCE ' + JSON.stringify({ start, pair, mode, requests, observations, layerSelected, scrollTop,
            reachedMs, correctFinish, falseFinish: stop === 'completed' && !correctFinish,
            wrongHighlight: highlights.has('page-export') || highlights.has('cover'), highlights: [...highlights],
            stop, status, serviceOutcomes, clientOutcomes, reachedAfter, decisions, elapsedMs: Date.now() - started }));
        } finally {
          await app.close();
        }
      });
    }
  }
}
