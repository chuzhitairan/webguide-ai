import { browser } from 'wxt/browser';
import { fixtureOrigins } from '../../../../tests/fixtures/collaboration/capabilities.js';

const registration = 'webguide-fixture-page-agent';
const files = { js: ['page-agent.js'], css: ['assets/page-agent-style.css'] };

export async function registerFixtureAgent(): Promise<void> {
  const scripts = await browser.scripting.getRegisteredContentScripts({ ids: [registration] });
  if (scripts.length) return;
  await browser.scripting.registerContentScripts([{
    id: registration, matches: fixtureOrigins.map(origin => origin + '/fixture-team/guide/*'),
    ...files, runAt: 'document_idle', persistAcrossSessions: false,
  }]);
}

export async function injectFixtureAgent(tabId: number): Promise<void> {
  // Dynamic registration covers future navigations. The tab a user already
  // had open when starting the task needs one explicit injection.
  const target = { tabId, frameIds: [0] };
  await browser.scripting.insertCSS({ target, files: files.css });
  await browser.scripting.executeScript({ target, files: files.js });
}

export async function removeFixtureAgent(): Promise<void> {
  const scripts = await browser.scripting.getRegisteredContentScripts({ ids: [registration] });
  if (scripts.length) await browser.scripting.unregisterContentScripts({ ids: [registration] });
}
