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
    // 配置模型后单独申请该服务域名，用户引导的网页沿用 activeTab。
    optional_host_permissions: ['https://*/*'],
  },
});
