import type { ModelConfig } from './model-navigation.js';

export function readConfig(env: Record<string, string | undefined>): { host: '127.0.0.1'; port: number } {
  const rawPort = env.WG_PORT ?? '43130';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('WG_PORT 必须是 1 到 65535 之间的端口号');
  }
  return { host: '127.0.0.1', port };
}
export function readNavigationConfig(env: Record<string, string | undefined>):
  { model: ModelConfig; clientToken: string; origins: string[] } | undefined {
  const base = env.WG_MODEL_BASE_URL?.trim();
  const name = env.WG_MODEL_NAME?.trim();
  const key = env.WG_MODEL_API_KEY?.trim();
  const clientToken = env.WG_CLIENT_TOKEN?.trim();
  if (!base || !name || !key || !clientToken) return;
  if (!/^[\w-]{24,128}$/.test(clientToken)) throw new Error('WG_CLIENT_TOKEN 需要 24–128 个字母、数字、下划线或短横线。');
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('WG_MODEL_BASE_URL 需要 HTTPS API 地址。');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : path + '/chat/completions';
  const origins = (env.WG_ALLOWED_EXTENSION_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean);
  if (origins.some(origin => !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))) {
    throw new Error('WG_ALLOWED_EXTENSION_ORIGINS 需要填写 chrome-extension://扩展ID。');
  }
  return { model: { url: url.href, name, key }, clientToken, origins };
}
