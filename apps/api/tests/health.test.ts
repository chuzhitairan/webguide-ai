import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

describe('首轮本机服务', () => {
  it('直接注入请求即可检查服务，无需监听端口', async () => {
    const app = createApp();
    try {
      expect(app.server.listening).toBe(false);
      const health = await app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: 'ok', ai: 'disabled' });
      expect((await app.inject({ method: 'GET', url: '/api/v1/answers' })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('默认监听回环地址，并接受指定整数端口', () => {
    expect(readConfig({})).toEqual({ host: '127.0.0.1', port: 43130 });
    expect(readConfig({ WG_PORT: '65535' })).toEqual({ host: '127.0.0.1', port: 65535 });
  });

  it.each(['', '0', '65536', '1.5', '1e3', 'abc'])('拒绝不合法端口 %j', port => {
    expect(() => readConfig({ WG_PORT: port })).toThrow(/WG_PORT/);
  });
});