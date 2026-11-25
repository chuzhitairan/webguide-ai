import { createApp } from './app.js';
import { readConfig, readGuideConfig } from './config.js';
import { loadExperienceCatalog } from './experience.js';
import type { ExperienceCatalog } from './experience.js';
import { createModelGuide } from './guide.js';

let app: ReturnType<typeof createApp> | undefined;
try {
  const guide = readGuideConfig(process.env);
  let catalog: ExperienceCatalog | undefined;
  if (guide && process.env.WG_EXPERIENCE_ENABLED === '1') {
    try {
      catalog = loadExperienceCatalog();
      console.info('导航经验试验已开启：' + catalog.version);
    } catch {
      console.warn('经验目录无法读取，继续使用无经验引导。');
    }
  }
  app = createApp(guide && { token: guide.token, origins: guide.origins, catalog, decide: createModelGuide(guide.model) },
    diagnostic => console.info('[guide]', JSON.stringify(diagnostic)));
  const url = await app.listen(readConfig(process.env));
  console.log('WebGuide AI 本机服务：' + url);
} catch (error) {
  console.error(error);
  await app?.close();
  process.exitCode = 1;
}
