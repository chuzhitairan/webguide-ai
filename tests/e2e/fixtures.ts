import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

const extension = resolve('apps/extension/.output/chrome-mv3');

export const test = base.extend<{ panel: Page }>({
  panel: async ({}, use, testInfo) => {
    const root = resolve(testInfo.outputDir);
    await mkdir(root, { recursive: true });
    const profile = await mkdtemp(resolve(root, 'chromium-'));
    try {
      const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
        headless: true,
      });
      try {
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
        const extensionId = new URL(worker.url()).hostname;
        const panel = context.pages()[0] ?? await context.newPage();
        await panel.goto('chrome-extension://' + extensionId + '/sidepanel.html');
        await use(panel);
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
