import { parseDecision } from '../../../api/src/guide-protocol.js';
import type { GuideRequest } from '../../../api/src/guide-protocol.js';

const requestTimeoutMs = 15_000;

export async function chooseGuide(input: GuideRequest, token: string, signal: AbortSignal) {
  const started = performance.now();
  let response: Response | undefined;
  let value: unknown;
  const timeout = AbortSignal.timeout(requestTimeoutMs);
  const requestSignal = AbortSignal.any([signal, timeout]);
  try {
    response = await fetch('http://127.0.0.1:43130/api/v1/guide', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(input),
      signal: requestSignal,
      redirect: 'error',
    });
    if (response.ok) value = await response.json();
    requestSignal.throwIfAborted();
  } catch {
    if (requestSignal.aborted) {
      // 先触发的信号才是这次请求的取消原因。后端只能看到浏览器已断开。
      const requestExpired = timeout.aborted && requestSignal.reason === timeout.reason;
      const reason: unknown = requestSignal.reason;
      const outcome = requestExpired ? 'request-deadline'
        : reason instanceof DOMException && reason.name === 'TimeoutError' ? 'round-deadline' : 'guide-interrupted';
      console.debug('[guide]', { outcome, elapsedMs: Math.round(performance.now() - started) });
      if (requestExpired) throw new Error('等待模型响应超时，可以重试。');
      requestSignal.throwIfAborted();
    }
    if (response) throw new Error('本机服务返回了无法识别的指引。');
    throw new Error('暂时无法连接本机模型服务。请检查服务是否已启动。');
  }
  if (response.status === 401 || response.status === 403) throw new Error('本机服务未授权。请检查访问令牌和扩展来源。');
  if (response.status === 503) throw new Error('本机服务还未配置模型。');
  if (response.status === 504) throw new Error('等待模型响应超时，可以重试。');
  if (!response.ok) throw new Error('暂时没有取得模型指引，可以重试。');
  const decision = parseDecision(value);
  if (!decision) throw new Error('模型返回了无法识别的指引。');
  return decision;
}
