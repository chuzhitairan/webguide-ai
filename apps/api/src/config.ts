export function readConfig(env: Record<string, string | undefined>): { host: '127.0.0.1'; port: number } {
  const rawPort = env.WG_PORT ?? '43130';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('WG_PORT 必须是 1 到 65535 之间的端口号');
  }
  return { host: '127.0.0.1', port };
}