import { expect, test } from './fixtures.js';

test('loads the real-time navigation sidebar from the production extension', async ({ panel }) => {
  await expect(panel.getByRole('heading', { name: '实时网页引导' })).toBeVisible();
  await expect(panel.getByText('实时导航尚未接入。')).toBeVisible();
});
