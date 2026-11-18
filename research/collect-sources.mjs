import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This script reads Git metadata and source text; it never imports downloaded code.
const base = dirname(fileURLToPath(import.meta.url));
const definitions = [
  {
    name: 'ontheway', category: '直接相关：录制、AI 生成、引导 SDK',
    license: 'README 与 packages/sdk/package.json 声明 MIT；根目录未发现独立 LICENSE 文件。',
    refs: [
      ['src/app/api/ai/generate/route.ts', 'export async function POST', '页面 DOM + 意图生成步骤；不是文档学习或沙盒验证'],
      ['packages/sdk/src/index.ts', 'const setupClickListener =', '实际 SDK 的点击推进、跨页恢复、完成统计'],
      ['packages/sdk/src/index.ts', 'private waitForElement(', 'MutationObserver 等待目标'],
      ['packages/sdk/src/index.ts', 'public async generateSteps(', 'SDK 调用 AI 生成接口'],
      ['packages/sdk/src/devtools.tsx', 'function genSelector(', '录制选择器生成'],
    ],
  },
  {
    name: 'usertour', category: '直接相关：完整用户引导平台',
    license: '混合许可：一般代码为 MIT；enterprise/ee 路径及功能、权限、角色、套餐开关代码存在例外，见 LICENSE 和 LICENSE.enterprise。',
    refs: [
      ['apps/sdk/src/core/usertour-element-watcher.ts', 'export class UsertourElementWatcher', '目标查找、重试、可见性与生命周期'],
      ['apps/sdk/src/core/usertour-rules-evaluator.ts', 'private async isActiveRulesByElement(', '存在、禁用、点击等条件判断'],
      ['apps/sdk/src/core/usertour-conditions-monitor.ts', 'private async evaluateCondition(', '周期条件评估与状态跟踪'],
      ['packages/finder/src/finderx.ts', 'export type Target =', '多种定位信息与上下文结构'],
    ],
  },
  {
    name: 'driver.js', category: '基础组件：高亮与交互引导', license: 'MIT，见 license。',
    refs: [
      ['packages/driver/src/tour/removal.ts', 'export function watchForRemoval(', '目标移除检测、重新绑定、规则回退'],
      ['packages/driver/src/tour/advance.ts', 'export function listenForAdvanceEvents(', '按用户事件及条件推进'],
      ['packages/driver/src/tour/wait.ts', 'export function waitForStepElement(', '有超时的元素等待'],
      ['packages/driver/tests/tour/action-steps.test.ts', 'previousAction', '回退与等待的上游测试样例；本次未执行'],
    ],
  },
  {
    name: 'shepherd', category: '基础组件：声明式引导流程',
    license: '根 LICENSE.md 声明 AGPL-3.0 / 商业双许可；不要按 MIT 组件处理。',
    refs: [
      ['shepherd.js/src/step.ts', 'beforeShowPromise?:', '显示前异步准备'],
      ['shepherd.js/src/step.ts', 'waitForElement?:', '元素等待选项'],
      ['shepherd.js/src/tour.ts', 'skipMissingElement', '缺失目标跳过与流程调度'],
      ['shepherd.js/AGENTS.md', 'Tours as data', 'JSON Schema 与函数选项的边界说明'],
    ],
  },
  {
    name: 'rrweb', category: '基础组件：网页事件录制与回放', license: 'MIT，见 LICENSE。',
    refs: [
      ['packages/rrweb/src/record/index.ts', 'const maskInputOptions:', '录制入口、快照配置与输入脱敏默认值'],
      ['packages/rrweb/src/record/observer.ts', 'export const mutationBuffers', 'DOM/交互事件观察'],
      ['packages/rrweb/src/replay/index.ts', 'export class Replayer', '历史页面回放；不等于真实网页教程执行'],
    ],
  },
  {
    name: 'nanobrowser', category: '参考架构：浏览器扩展与页面感知', license: 'Apache-2.0，见 LICENSE。',
    refs: [
      ['src/browser-control/core/refs.ts', 'export class RefRegistry', '绑定文档生命周期的元素引用'],
      ['src/browser-control/core/perception/observe.ts', 'export function buildObservation(', '预算受限的页面表示与引用生成'],
      ['src/browser-control/protocol/results.ts', 'export interface ActionReceipt', '区分动作送达、页面反应、后置条件'],
      ['src/browser-control/core/interaction/evidence.ts', 'export class Evidence', '动作前后证据收集；不直接判定业务成功'],
    ],
  },
  {
    name: 'browser-use', category: '参考架构：自主浏览器 Agent', license: 'MIT，见 LICENSE。',
    refs: [
      ['browser_use/agent/loop.py', 'async def run(', '有预算的运行循环、超时和部分结果'],
      ['browser_use/agent/views.py', 'class AgentHistoryList:', '完成状态与 Agent 自报成功分开'],
      ['browser_use/repl/worker.py', 'def checkpoint(', '结果检查点及输出脱敏'],
      ['AGENTS.md', 'Browser Use 1.0', '当前架构已是持久 Python REPL，不应照搬旧版教程'],
    ],
  },
  {
    name: 'stagehand', category: '参考接口：观察、执行与结构化提取', license: 'MIT，见 LICENSE。',
    refs: [
      ['packages/sdk-ts/src/stagehand.ts', 'async observe(', '观察入口；当前 SDK 通过 RPC 转发'],
      ['packages/sdk-ts/src/stagehand.ts', 'async act(instruction: string | Action,', '意图或结构化动作执行接口'],
      ['packages/docs/v4/best-practices/caching.mdx', 'Caching requires a Browserbase browser', 'v4 缓存属于托管服务，不能当作本地缓存实现'],
    ],
  },
  {
    name: 'OpenAdapt', category: '参考架构：示范编译、确定性执行、受控修复',
    license: '根目录和 Flow 引擎为 MIT；benchmark、third_party 等目录有独立许可，不能将根许可套用到所有文件。',
    refs: [
      ['packages/flow/docs/BROWSER_RECORDING.md', 'OpenAdapt has one supported browser recording contract.', '浏览器录制的数据契约与 before/after 证据'],
      ['packages/flow/openadapt_flow/compiler/compile.py', 'def compile_recording(', '录制记录编译成工作流包'],
      ['packages/flow/openadapt_flow/ir.py', 'class Step(BaseModel):', '步骤意图、锚点、后置条件和效果断言'],
      ['packages/flow/openadapt_flow/runtime/replayer.py', 'Per step: settle, screenshot, resolve', '运行流程与业务效果验证边界'],
      ['packages/flow/openadapt_flow/repair/self_repair.py', 'class SelfRepair', '修复候选、探测与批准流程'],
    ],
  },
];

function git(folder, ...args) {
  return execFileSync('git', ['--no-optional-locks', '-C', folder, ...args], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  }).trim();
}

const repositories = definitions.map(def => {
  const folder = join(base, 'repos', def.name);
  const commit = git(folder, 'rev-parse', 'HEAD');
  const origin = git(folder, 'remote', 'get-url', 'origin');
  const homepage = origin.replace(/\.git$/, '');
  const tracked = git(folder, 'ls-files', '-z').split('\0').filter(Boolean);
  let bytes = 0;
  const missing = [];
  for (const file of tracked) {
    const full = join(folder, file);
    if (existsSync(full)) bytes += statSync(full).size;
    else missing.push(file);
  }
  const references = def.refs.map(([file, anchor, purpose]) => {
    const content = readFileSync(join(folder, file), 'utf8');
    const lines = content.split(/\r?\n/);
    const line = lines.findIndex(value => value.includes(anchor)) + 1;
    if (!line) throw new Error(`Missing anchor: ${def.name}/${file}: ${anchor}`);
    return { file, line, purpose, sha256: createHash('sha256').update(content).digest('hex'),
      permalink: `${homepage}/blob/${commit}/${file}#L${line}` };
  });
  const status = git(folder, 'status', '--porcelain', '--untracked-files=no');
  if (status || missing.length) throw new Error(`Incomplete or changed checkout: ${def.name}`);
  return {
    name: def.name, category: def.category, origin, homepage, commit,
    branch: git(folder, 'branch', '--show-current'),
    commit_time: git(folder, 'log', '-1', '--format=%cI'),
    shallow: git(folder, 'rev-parse', '--is-shallow-repository') === 'true',
    tracked_files: tracked.length, tracked_bytes: bytes, clean: !status,
    license_note: def.license,
    root_license_files: readdirSync(folder).filter(file => /^licen[cs]e/i.test(file)),
    references,
  };
});

const manifest = { review_date: '2026-11-13', collected_at_utc: new Date().toISOString(),
  method: '官方公开仓库的 depth=1 工作树；针对核心路径的静态阅读，未安装依赖或运行上游项目。', repositories };
writeFileSync(join(base, 'sources.json'), JSON.stringify(manifest, null, 2) + '\n');
const rows = ['# 源码阅读索引', '', '调研日期：2026-11-13。每个链接固定到本次下载的提交；这是一轮针对关键路径的静态阅读，并非对完整项目的运行验收。', '',
  '版本、来源、文件数量、参考文件 SHA-256 见 [sources.json](../sources.json)。', ''];
for (const repo of repositories) {
  rows.push(`## ${repo.name}`, '', `${repo.category}。提交：\`${repo.commit}\`。`, '',
    `许可记录：${repo.license_note}`, '', '| 阅读入口 | 关注内容 | 固定版本来源 |', '| --- | --- | --- |');
  for (const ref of repo.references) {
    rows.push(`| [${ref.file}:${ref.line}](../repos/${repo.name}/${ref.file}) | ${ref.purpose} | [源码](${ref.permalink}) |`);
  }
  rows.push('');
}
writeFileSync(join(base, 'notes', '源码阅读索引.md'), rows.join('\n'));
console.log(JSON.stringify({ repositories: repositories.length,
  tracked_files: repositories.reduce((sum, repo) => sum + repo.tracked_files, 0),
  tracked_mib: +(repositories.reduce((sum, repo) => sum + repo.tracked_bytes, 0) / 1024 / 1024).toFixed(1),
  checked_references: repositories.reduce((sum, repo) => sum + repo.references.length, 0),
  clean_checkouts: repositories.every(repo => repo.clean),
  output: resolve(base, 'sources.json') }, null, 2));
