import { readFile } from 'node:fs/promises';
import { readGuideConfig } from '../../apps/api/dist/config.js';
import { createModelGuide, ModelRequestError, validateDecision } from '../../apps/api/dist/guide.js';
import { isGuideRequest } from '../../apps/api/dist/guide-protocol.js';

const capture = process.argv[2];
const config = readGuideConfig(process.env)?.model;
if (!capture || !config) throw new Error('请加载 apps/api/.env 并传入 Figma 模拟页的观察文件。');

const { input: captured } = JSON.parse(await readFile(capture, 'utf8'));
if (!isGuideRequest(captured) || captured.page.site !== 'www.figma.com' || !captured.previous?.instruction) {
  throw new Error('观察文件须包含通过正式校验且带上一条指引的 Figma 请求。');
}
const { goal, page, reads } = captured;
// 固定同一次观察。清空先前保存的判断，让三组从同一个目标出发。
const base = { goal, page, reads, finishOnly: false, requirements: [] };
const nodes = new Map([...page.nodes, ...reads.flatMap(read => read.nodes)].map(node => [node.id, node]));
const controls = [...nodes.values()].filter(node => node.role === 'button' && node.label === 'Add export settings');
const target = controls.find(node => nodes.get(node.region)?.label === 'Export');
const alternative = controls.find(node => nodes.get(node.region)?.label === 'Page export');
if (!target?.viewport || !target.available || !alternative) {
  throw new Error('对照需要滚动后可用的图层导出按钮和页面级同名按钮。');
}

function ancestorIds(node) {
  const ids = new Set();
  for (let id = node.region; id !== undefined && !ids.has(id); id = nodes.get(id)?.region) ids.add(id);
  return ids;
}

const competingScopes = ancestorIds(alternative);
const targetScopes = [...ancestorIds(target)].filter(id => !competingScopes.has(id));
const variations = [
  { name: 'none' },
  { name: 'instruction', previous: captured.previous },
  { name: 'progress', previous: { instruction: '已滚动右侧设计面板。' } },
];

const decide = createModelGuide(config);
// 平衡每种顺序，避免某一组总是先请求。
const orders = [[0, 1, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0], [1, 0, 2], [0, 2, 1]];
for (const [round, order] of orders.entries()) {
  for (const index of order) {
    const { name, previous } = variations[index];
    const input = { ...base, ...(previous ? { previous } : {}) };
    if (!isGuideRequest(input)) throw new Error('对照请求没有通过正式校验。');
    const started = Date.now();
    const signal = AbortSignal.timeout(15_000);
    try {
      const raw = await decide(input, signal);
      const result = validateDecision(raw, input);
      const conditions = result?.requirements ?? input.requirements;
      const proof = result?.proofs?.find(item => item.index === 0 && item.targetId === target.id);
      const correctProof = conditions.length === 1 && conditions[0].source === 'point' && !!proof
        && proof.checks.every(check => {
          const evidence = nodes.get(check.id);
          return evidence?.viewport && evidence[check.field] === check.equals;
        })
        && proof.checks.some(check => check.id === target.id && check.field === 'label')
        && proof.checks.some(check => check.field === 'label' && targetScopes.includes(check.id));
      console.log(JSON.stringify({ round: round + 1, variant: name, ms: Date.now() - started,
        kind: raw?.kind, valid: !!result, correctTarget: result?.kind === 'highlight' && result.targetId === target.id,
        correctProof, conditions: conditions.map(item => item.source), proofCount: result?.proofs?.length ?? 0 }));
    } catch (error) {
      if (!signal.aborted && !(error instanceof ModelRequestError)) throw error;
      console.log(JSON.stringify({ round: round + 1, variant: name, ms: Date.now() - started,
        error: signal.aborted ? 'request-deadline' : error.failure.outcome }));
    }
  }
}
