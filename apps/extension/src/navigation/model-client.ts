import type { ModelRequest, ModelResponse } from './protocol.js';

export async function chooseNavigation({ token, goal, page, review }: ModelRequest): Promise<ModelResponse> {
  try {
    const response = await fetch('http://127.0.0.1:43130/api/v1/navigate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ goal, page, review }),
      signal: AbortSignal.timeout(24_000),
      redirect: 'error',
    });
    const result = await response.json();
    if (!response.ok) return { error: typeof result.error === 'string' ? result.error : '本机服务无法提供指引，请重试。' };
    if (review && result.kind === 'keep') return { decision: result };
    if (typeof result.instruction === 'string' && (result.kind === 'message'
      || (result.kind === 'highlight' && Number.isInteger(result.targetId)))) return { decision: result };
    return { error: '本机服务返回了无法识别的建议，请重试。' };
  } catch {
    return { error: '暂时无法连接本机导航服务，请确认服务已启动。' };
  }
}
