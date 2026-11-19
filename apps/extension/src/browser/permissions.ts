import { browser } from 'wxt/browser';
import { fixtureOrigins } from '../../../../tests/fixtures/collaboration/capabilities.js';

export async function fixtureHostGranted(): Promise<boolean> {
  return browser.permissions.contains({ origins: fixtureOrigins.map(origin => origin + '/*') });
}
