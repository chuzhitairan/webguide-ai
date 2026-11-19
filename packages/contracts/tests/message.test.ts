import { describe, expect, it } from 'vitest';
import { parseEnvelope } from '../src/index.js';

const handshake = { protocolVersion: 1, type: 'UI_HELLO', messageId: 'hello', payload: { uiInstanceId: 'panel-1' } };
const pause = {
  protocolVersion: 1, type: 'USER_PAUSE', messageId: 'pause-1', coordinatorEpoch: 'epoch-1',
  taskId: 'task-1', contextRevision: 5, payload: { uiInstanceId: 'panel-1', expectedSessionRevision: 4 },
};

describe('扩展消息格式', () => {
  it('接受初次握手与带有效上下文的命令', () => {
    expect(parseEnvelope(handshake)).toEqual({ ok: true, envelope: handshake });
    expect(parseEnvelope(pause)).toEqual({ ok: true, envelope: pause });
  });

  it('按 UTF-8 字节拒绝超限消息', () => {
    const payload = { value: '测'.repeat(25000) };
    expect(parseEnvelope({ ...pause, payload })).toMatchObject({ ok: false, code: 'MESSAGE_TOO_LARGE' });
  });

  it('拒绝格式版本错误、未注册消息与缺失的上下文', () => {
    expect(parseEnvelope({ ...handshake, protocolVersion: 2 })).toMatchObject({ ok: false, code: 'UNSUPPORTED_PROTOCOL_VERSION' });
    expect(parseEnvelope({ ...pause, type: 'SOMETHING_UNKNOWN' })).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
    expect(parseEnvelope({ ...pause, contextRevision: -1 })).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
    const withoutEpoch = { ...pause, coordinatorEpoch: undefined };
    expect(parseEnvelope(withoutEpoch)).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
  });

  it('拒绝外层额外字段与不可序列化值', () => {
    expect(parseEnvelope({ ...pause, trusted: true })).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
    expect(parseEnvelope({ ...pause, payload: [] })).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
    expect(parseEnvelope({ ...pause, payload: { extra: 3n } })).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
  });
});