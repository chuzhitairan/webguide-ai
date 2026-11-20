import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

const extension = resolve('apps/extension/.output/chrome-mv3');

type ExtensionPages = { panel: Page; grantAccess(site: Page): Promise<void> };

export const test = base.extend<{ extensionPages: ExtensionPages }>({
  extensionPages: async ({}, use, testInfo) => {
    const root = resolve(testInfo.outputDir);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(root, { recursive: true });
    const profile = await mkdtemp(resolve(root, 'chromium-'));
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
      const debuggingPort = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split(/\s+/)[0];
      const browser = await chromium.connectOverCDP('http://127.0.0.1:' + debuggingPort);
      try {
        // 在独立的浏览器上触发工具栏按钮，让 Chromium 自己授予 activeTab。
        const command = await browser.newBrowserCDPSession();
        await use({
          panel,
          async grantAccess(site) {
            const { targetInfos } = await command.send('Target.getTargets', { filter: [{ type: 'tab' }] });
            const target = targetInfos.find(candidate => candidate.url === site.url());
            if (!target) throw new Error('Could not find the browser tab for ' + site.url());
            await command.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
          },
        });
      } finally {
        await browser.close();
      }
    } finally {
      await context.close();
      // This is the profile created for this test, within Playwright's own output directory.
      if (pathToFileURL(profile).href.startsWith(pathToFileURL(root).href + '/')) {
        await rm(profile, { recursive: true, force: true, maxRetries: 3 });
      }
    }
  },
});
export { expect } from '@playwright/test';
