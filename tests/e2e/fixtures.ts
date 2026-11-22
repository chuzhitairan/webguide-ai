import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

const extension = resolve('apps/extension/.output/chrome-mv3');

export const test = base.extend<{ extension: { panel: Page; activate(site: Page): Promise<void> } }>({
  extension: async ({}, use, testInfo) => {
    const root = resolve(testInfo.outputDir);
    await mkdir(root, { recursive: true });
    const profile = await mkdtemp(resolve(root, 'chromium-'));
    try {
      const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension,
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
