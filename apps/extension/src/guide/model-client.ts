import catalog from '../../../api/experience-catalog.json';
import { createModelGuide, ModelRequestError, validateDecision } from '../../../api/src/guide.js';
import type { ModelConfig } from '../../../api/src/guide.js';
import { experienceForSite } from '../../../api/src/experience-catalog.js';
import type { ExperienceCatalog } from '../../../api/src/experience-catalog.js';
import { isGuideRequest } from '../../../api/src/guide-protocol.js';
import type { GuideRequest } from '../../../api/src/guide-protocol.js';

const requestTimeoutMs = 15_000;

export async function chooseGuide(input: GuideRequest, model: ModelConfig, signal: AbortSignal, useExperience = false) {
  if (!isGuideRequest(input)) throw new Error('当前页面信息的格式无法用于引导，可以重新试一次。');
  const started = performance.now();
  let value: unknown;
  const timeout = AbortSignal.timeout(requestTimeoutMs);
  const requestSignal = AbortSignal.any([signal, timeout]);
  try {
    // 页面脚本只提供观察。模型密钥和网络请求都留在扩展侧栏。
    const experience = useExperience ? experienceForSite(catalog as ExperienceCatalog, input.page.site) : [];
    value = await createModelGuide(model)(input, requestSignal, experience);
    requestSignal.throwIfAborted();
  } catch (error) {
    if (requestSignal.aborted) {
      // 先触发的信号才是这次请求的取消原因。
      const requestExpired = timeout.aborted && requestSignal.reason === timeout.reason;
      const reason: unknown = requestSignal.reason;
      const outcome = requestExpired ? 'request-deadline'
        : reason instanceof DOMException && reason.name === 'TimeoutError' ? 'round-deadline' : 'guide-interrupted';
      console.debug('[guide]', { outcome, elapsedMs: Math.round(performance.now() - started) });
      if (requestExpired) throw new Error('等待模型响应超时，可以重试。');
      requestSignal.throwIfAborted();
    }
    if (!(error instanceof ModelRequestError)) throw error;
    const failure = error.failure;
    console.debug('[guide]', { ...failure, elapsedMs: Math.round(performance.now() - started) });
    if (failure.outcome === 'model-connection') throw new Error('无法连接模型服务。请检查网络和模型 API 地址。');
    if (failure.outcome === 'model-http') {
      if (failure.upstreamStatus === 401 || failure.upstreamStatus === 403) {
        throw new Error('模型服务拒绝访问。请检查 API 密钥和网络权限。');
      }
      if (failure.upstreamStatus === 429) throw new Error('模型服务请求过多或额度不足，可以稍后重试。');
      if (failure.upstreamStatus === 504) throw new Error('等待模型响应超时，可以重试。');
    }
    throw new Error('暂时没有取得模型指引，可以重试。');
  }
  const decision = validateDecision(value, input);
  if (!decision) {
    console.debug('[guide]', { outcome: 'decision-rejected', elapsedMs: Math.round(performance.now() - started) });
    throw new Error('模型返回了无法识别的指引，可以重试。');
  }
  return decision;
}
