import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  browser: 'chrome',
  manifestVersion: 3,
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}',
  webExt: { disabled: true },
  manifest: {
    name: 'WebGuide AI',
    action: { default_title: '打开 WebGuide AI' },
    permissions: ['sidePanel', 'activeTab', 'scripting', 'storage'],
    host_permissions: ['http://127.0.0.1/*'],
  },
});
