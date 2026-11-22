import { createApp } from './app.js';
import { readConfig, readGuideConfig } from './config.js';
import { createModelGuide } from './guide.js';

let app: ReturnType<typeof createApp> | undefined;
try {
  const guide = readGuideConfig(process.env);
  app = createApp(guide && { token: guide.token, origins: guide.origins, decide: createModelGuide(guide.model) });
  const url = await app.listen(readConfig(process.env));
  console.log('WebGuide AI 本机服务：' + url);
} catch (error) {
  console.error(error);
  await app?.close();
  process.exitCode = 1;
}
