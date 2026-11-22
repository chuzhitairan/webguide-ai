import { expect, test } from './fixtures.js';

test('生产扩展启动后台并加载侧栏页面', async ({ panel }) => {
  await expect(panel.getByRole('heading', { name: 'WebGuide AI' })).toBeVisible();
});
