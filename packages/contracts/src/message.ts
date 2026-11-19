export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 64 * 1024;

const messageTypes = [
  'UI_HELLO', 'PAGE_HELLO', 'HELLO_ACK', 'USER_START', 'USER_CONTINUE', 'USER_RECHECK',
  'USER_BACK', 'USER_ADVANCE', 'USER_PAUSE', 'USER_CONFIRM_ANCHOR', 'EXIT',
  'CHECK_REQUEST', 'OBSERVATION', 'LOCATION_INVALIDATED', 'SHOW_GUIDE', 'STOP', 'STOP_ACK',
  'CANCEL_REQUEST', 'SESSION_SNAPSHOT', 'ERROR',
] as const;
export type MessageType = typeof messageTypes[number];

export interface Envelope {
  protocolVersion: 1;
  type: MessageType;
  messageId: string;
  coordinatorEpoch?: string;
  taskId?: string;
  contextRevision?: number;
  payload: Record<string, unknown>;
}
type FailureCode = 'INVALID_MESSAGE' | 'UNSUPPORTED_PROTOCOL_VERSION' | 'MESSAGE_TOO_LARGE';
export type EnvelopeResult =
  | { ok: true; envelope: Envelope }
  | { ok: false; code: FailureCode; issues: { path: string; message: string }[] };

const envelopeKeys = new Set(['protocolVersion', 'type', 'messageId', 'coordinatorEpoch', 'taskId', 'contextRevision', 'payload']);
const knownTypes: ReadonlySet<unknown> = new Set(messageTypes);
const noTask = new Set(['HELLO_ACK', 'USER_START', 'ERROR', 'SESSION_SNAPSHOT']);

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function error(code: FailureCode, path: string, message: string): EnvelopeResult {
  return { ok: false, code, issues: [{ path, message }] };
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

export function parseEnvelope(raw: unknown): EnvelopeResult {
  if (!isRecord(raw) || !isRecord(raw.payload)) return error('INVALID_MESSAGE', '/', '消息及其内容需要为对象');
  let serialized: string;
  try {
    serialized = JSON.stringify(raw, (_key, value: unknown) => {
      if (value === undefined || typeof value === 'function' || typeof value === 'symbol'
        || (typeof value === 'number' && !Number.isFinite(value))) {
        throw new TypeError('消息包含无法表示的值');
      }
      return value;
    });
  } catch {
    return error('INVALID_MESSAGE', '/', '无法将消息表示为 JSON');
  }
  if (new TextEncoder().encode(serialized).length > MAX_MESSAGE_BYTES) {
    return error('MESSAGE_TOO_LARGE', '/', '消息超过 64 KiB');
  }
  if (raw.protocolVersion !== PROTOCOL_VERSION) return error('UNSUPPORTED_PROTOCOL_VERSION', '/protocolVersion', '不支持的协议版本');
  if (!knownTypes.has(raw.type) || !identifier(raw.messageId)) return error('INVALID_MESSAGE', '/', '消息类型或编号无效');
  const extra = Object.keys(raw).find(key => !envelopeKeys.has(key));
  if (extra) return error('INVALID_MESSAGE', '/' + extra, '未声明的消息字段');

  // 握手用于获取本轮后台身份，之后发出的命令才可以带任务上下文。
  const type = raw.type as MessageType;
  if (type === 'UI_HELLO' || type === 'PAGE_HELLO') {
    if (raw.coordinatorEpoch !== undefined || raw.taskId !== undefined || raw.contextRevision !== undefined) {
      return error('INVALID_MESSAGE', '/', '初次握手不能带旧任务上下文');
    }
  } else if (!identifier(raw.coordinatorEpoch)) {
    return error('INVALID_MESSAGE', '/coordinatorEpoch', '缺少后台身份');
  }
  if (!noTask.has(type) && type !== 'UI_HELLO' && type !== 'PAGE_HELLO' && !identifier(raw.taskId)) {
    return error('INVALID_MESSAGE', '/taskId', '缺少任务编号');
  }
  if (raw.taskId !== undefined && (!identifier(raw.taskId) || !Number.isSafeInteger(raw.contextRevision) || Number(raw.contextRevision) < 0)) {
    return error('INVALID_MESSAGE', '/contextRevision', '任务消息需要有效的上下文版本');
  }
  // 格式正确只说明能读懂消息。窗口和页面身份由浏览器路由另行确认。
  return { ok: true, envelope: raw as unknown as Envelope };
}