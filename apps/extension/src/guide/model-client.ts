import { parseDecision } from '../../../api/src/guide-protocol.js';
import type { GuideRequest } from '../../../api/src/guide-protocol.js';

export async function chooseGuide(input: GuideRequest, token: string, signal: AbortSignal) {
  let response: Response;
  const timeout = AbortSignal.timeout(9_000);
  try {
    response = await fetch('http://127.0.0.1:43130/api/v1/guide', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(input),
      signal: AbortSignal.any([signal, timeout]),
      redirect: 'error',
    });
  } catch {
    if (timeout.aborted) throw new Error('等待模型响应超时，可以重试。');
    throw new Error('暂时无法连接本机模型服务。请检查服务是否已启动。');
  }
  if (response.status === 401 || response.status === 403) throw new Error('本机服务未授权。请检查访问令牌和扩展来源。');
  if (response.status === 503) throw new Error('本机服务还未配置模型。');
  if (response.status === 504) throw new Error('等待模型响应超时，可以重试。');
  if (!response.ok) throw new Error('暂时没有取得模型指引，可以重试。');
  const decision = parseDecision(await response.json());
  if (!decision) throw new Error('模型返回了无法识别的指引。');
  return decision;
}
