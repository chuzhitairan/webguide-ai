import { createApp } from './app.js';
import { readConfig } from './config.js';

const app = createApp();
try {
  const url = await app.listen(readConfig(process.env));
  console.log('WebGuide AI 本机服务：' + url);
} catch (error) {
  console.error(error);
  await app.close();
  process.exitCode = 1;
}