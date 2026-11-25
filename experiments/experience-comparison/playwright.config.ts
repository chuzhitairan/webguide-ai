import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'figma-export.spec.ts',
  outputDir: resolve('tmp/experience-comparison'),
  workers: 1,
  timeout: 125_000,
});
