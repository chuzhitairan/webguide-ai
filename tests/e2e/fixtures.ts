import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, test as base } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

interface Simulation { context: BrowserContext; panel: Page; site: Page }
const extension = resolve('apps/extension/.output-test/chrome-mv3');
const fixture = 'http://127.0.0.1:43131/fixture-team/guide/issue?number=1';

export const test = base.extend<{ simulation: Simulation }>({
  simulation: async ({}, use, testInfo) => {
    const root = resolve(testInfo.outputDir);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(root, { recursive: true });
    const profile = await mkdtemp(resolve(root, 'chromium-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
      headless: true,
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const site = context.pages()[0] ?? await context.newPage();
      await site.goto(fixture);
      const panel = await context.newPage();
      await panel.goto('chrome-extension://' + new URL(worker.url()).hostname + '/sidepanel.html');
      await site.bringToFront();
      await use({ context, panel, site });
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