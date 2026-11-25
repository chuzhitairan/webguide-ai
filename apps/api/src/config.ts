import { configureModel } from './guide.js';
import type { GuideService, ModelConfig } from './guide.js';

const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/;

export function isExtensionOrigin(origin: unknown): origin is string {
  return typeof origin === 'string' && extensionOrigin.test(origin);
}

export function readConfig(env: Record<string, string | undefined>): { host: '127.0.0.1'; port: number } {
  const rawPort = env.WG_PORT ?? '43130';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('WG_PORT 必须是 1 到 65535 之间的端口号');
  }
  return { host: '127.0.0.1', port };
}

export function readGuideConfig(env: Record<string, string | undefined>):
  (Pick<GuideService, 'token' | 'origins'> & { model: ModelConfig }) | undefined {
  const base = env.WG_MODEL_BASE_URL?.trim();
  const name = env.WG_MODEL_NAME?.trim();
  const key = env.WG_MODEL_API_KEY?.trim();
  const token = env.WG_CLIENT_TOKEN?.trim();
  if (!base || !name || !key || !token) return;
  if (!/^[\w-]{24,128}$/.test(token)) {
    throw new Error('WG_CLIENT_TOKEN 需要 24–128 个字母、数字、下划线或短横线。');
  }
  let model: ModelConfig;
  try {
    model = configureModel(base, name, key, env.WG_MODEL_REASONING_EFFORT?.trim());
  } catch {
    throw new Error('WG_MODEL_BASE_URL 需要 HTTPS API 地址。');
  }
  const origins = (env.WG_ALLOWED_EXTENSION_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean);
  if (!origins.every(isExtensionOrigin)) {
    throw new Error('WG_ALLOWED_EXTENSION_ORIGINS 需要填写 chrome-extension://扩展ID。');
  }
  return { model, token, origins };
}
