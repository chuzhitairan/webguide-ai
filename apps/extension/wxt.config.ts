import { defineConfig } from 'wxt';
import { fixtureOrigins } from '../../tests/fixtures/collaboration/capabilities.js';

export function makeConfig(withFixtures: boolean) {
  return defineConfig({
    modules: ['@wxt-dev/module-react'],
    browser: 'chrome',
    manifestVersion: 3,
    outDir: withFixtures ? '.output-test' : '.output',
    outDirTemplate: '{{browser}}-mv{{manifestVersion}}',
    webExt: { disabled: true },
    manifest: {
      name: withFixtures ? 'WebGuide AI · 协作模拟' : 'WebGuide AI',
      action: { default_title: '打开 WebGuide AI' },
      permissions: ['sidePanel', 'storage', 'scripting'],
      ...(withFixtures ? { host_permissions: fixtureOrigins.map(origin => origin + '/*') } : {}),
    },
    vite: () => ({
      // The fixture is only enabled in our dedicated training build.
      define: { __WEBGUIDE_FIXTURE__: JSON.stringify(withFixtures) },
    }),
  });
}

export default makeConfig(false);
