import { createApp } from './app.js';
import { readConfig, readNavigationConfig } from './config.js';
import { createModelNavigator } from './model-navigation.js';

const navigation = readNavigationConfig(process.env);
const app = createApp(navigation && {
  choose: createModelNavigator(navigation.model), clientToken: navigation.clientToken, origins: navigation.origins,
});
try {
  const url = await app.listen(readConfig(process.env));
  console.log('WebGuide AI 本机服务：' + url);
} catch (error) {
  console.error(error);
  await app.close();
  process.exitCode = 1;
}
