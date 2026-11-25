import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, test as base } from '@playwright/test';
import type { Page, Request, Route } from '@playwright/test';
import { ModelRequestError } from '../../apps/api/src/guide.js';
import type { GuideRequest } from '../../apps/api/src/guide-protocol.js';

const extension = resolve('apps/extension/.output/chrome-mv3');
const mockOrigin = 'https://webguide-model.example';
const mockEndpoint = mockOrigin + '/v1/chat/completions';

export async function mockModel(panel: Page, key: string, decide: (input: GuideRequest, signal: AbortSignal) => Promise<unknown>,
  report?: (outcome: 'replied' | 'client-disconnected') => void, useExperience = false) {
  const context = panel.context();
  const pending = new Map<Request, AbortController>();
  function disconnected(request: Request) {
    const controller = pending.get(request);
    if (!controller) return;
    controller.abort();
    report?.('client-disconnected');
  }
  async function reply(route: Route) {
    const request = route.request();
    if (await request.headerValue('authorization') !== 'Bearer ' + key) return route.fulfill({ status: 401 });
    const controller = new AbortController();
    pending.set(request, controller);
    try {
      // 只替代模型的 HTTPS 接口，浏览器照常拼消息、发送和验证回复。
      const { messages } = request.postDataJSON();
      const focus = JSON.parse(messages[1].content);
      const { page, reads, previous, feedback } = JSON.parse(messages[2].content);
      const result = await decide({ ...focus, page, reads, previous, feedback }, controller.signal);
      if (controller.signal.aborted) return;
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(result) } }] } });
      report?.('replied');
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!(error instanceof ModelRequestError)) throw error;
      await route.fulfill({ status: error.failure.outcome === 'model-http' ? error.failure.upstreamStatus : 502 });
    } finally {
      pending.delete(request);
    }
  }
  context.on('requestfailed', disconnected);
  await context.route(mockEndpoint, reply);
  await panel.getByText('模型设置', { exact: true }).click();
  await panel.getByLabel('模型 API 地址').fill(mockOrigin + '/v1');
  await panel.getByLabel('模型名称').fill('test-model');
  await panel.getByLabel('启用导航经验（试验）').setChecked(useExperience);
  await panel.getByText('模型设置', { exact: true }).click();
  return async () => {
    for (const controller of pending.values()) controller.abort();
    context.off('requestfailed', disconnected);
    await context.unroute(mockEndpoint, reply);
  };
}

export const test = base.extend<{ extension: { panel: Page; activate(site: Page): Promise<void> } }>({
  extension: async ({}, use, testInfo) => {
    const root = resolve(testInfo.outputDir);
    await mkdir(root, { recursive: true });
    const profile = await mkdtemp(resolve(root, 'chromium-'));
    try {
      const testExtension = resolve(profile, 'extension');
      await cp(extension, testExtension, { recursive: true });
      const manifestFile = resolve(testExtension, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
      // 测试使用单独打包的模拟模型域名。发布包按用户授权请求模型域名。
      manifest.host_permissions = [mockOrigin + '/*'];
      await writeFile(manifestFile, JSON.stringify(manifest));
      const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        args: ['--disable-extensions-except=' + testExtension, '--load-extension=' + testExtension,
          '--enable-unsafe-extension-debugging', '--remote-debugging-port=0'],
        headless: true,
      });
      try {
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
        const extensionId = new URL(worker.url()).hostname;
        const panel = context.pages()[0] ?? await context.newPage();
        await panel.goto('chrome-extension://' + extensionId + '/sidepanel.html');
        let debuggingBrowser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
        try {
          await use({
            panel,
            async activate(site) {
              // 触发浏览器工具栏动作，由 Chromium 本身授予 activeTab。
              const port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split(/\s+/)[0];
              debuggingBrowser ??= await chromium.connectOverCDP('http://127.0.0.1:' + port);
              const commands = await debuggingBrowser.newBrowserCDPSession();
              try {
                const { targetInfos } = await commands.send('Target.getTargets', { filter: [{ type: 'tab' }] });
                const target = targetInfos.find(info => info.url === site.url());
                if (!target) throw new Error('Could not find current browser tab');
                await commands.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
              } finally {
                await commands.detach();
              }
            },
          });
        } finally {
          await debuggingBrowser?.close();
        }
      } finally {
        await context.close();
      }
    } finally {
      // This is the profile created for this test, within Playwright's own output directory.
      if (pathToFileURL(profile).href.startsWith(pathToFileURL(root).href + '/')) {
        await rm(profile, { recursive: true, force: true, maxRetries: 3 });
      }
    }
  },
});
export { expect } from '@playwright/test';
