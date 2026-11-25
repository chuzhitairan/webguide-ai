import { readGuideConfig } from '../../apps/api/dist/config.js';
import { createModelGuide, ModelRequestError, validateDecision } from '../../apps/api/dist/guide.js';
import { isGuideRequest } from '../../apps/api/dist/guide-protocol.js';

const config = readGuideConfig(process.env)?.model;
if (!config) throw new Error('请先加载 apps/api/.env，再运行此实验。');

const original = '完成由扩展核对后决定。若无需下一步而已有终点证据，输出 keep 并附 proofs，例如：';
const candidate = '完成由扩展核对后决定。requirements 为空且已有结果证据时，在同一回复提交完整 requirements 和对应的 proofs。只有一项结果时，quote 用整句原话，proof 的 index 写 0。有多项独立结果时保留每一项，只给已经证实的项目提交证明。其余结果继续指引。已证明所有结果且无需下一步时输出 keep，例如：';
const pointProtocol = process.argv.includes('--point');
const implemented = pointProtocol || process.argv.includes('--implemented');

const node = (id, role, label, state = {}) => ({ id, role, label, viewport: true, available: true, ...state });
const page = (site, title, nodes) => ({ site, title, nodes, truncated: false });
const check = (id, field, equals) => ({ id, field, equals });
const label = ({ id, label }) => check(id, 'label', label);

const figmaGoal = '我想把 Frame 1 导出成图片，先帮我找到它的导出设置入口。';
const frame = node(1, 'treeitem', 'Frame 1', { selected: true });
const frameProperties = node(2, 'region', 'Design properties');
const frameExport = node(3, 'region', 'Export', { region: frameProperties.id });
const exportButton = node(4, 'button', 'Add export settings', { region: frameExport.id });
const pageExport = node(5, 'region', 'Page export');

const githubGoal = '我想看看侧栏闪烁的反馈，请帮我打开 GitHub 的第 42 号 Issue。';
const issueTitle = 'Fix sidebar flicker #42';
const issueLink = node(3, 'link', issueTitle);
const issueHeading = node(2, 'heading', issueTitle);
const issueEditor = node(4, 'textbox', 'Leave a comment');
const issueEditButton = node(5, 'button', 'Edit issue');
const issueDetails = node(1, 'main', 'Issue details');
const issueNodes = [issueHeading, node(3, 'status', 'Open'), issueEditor, issueEditButton];
const issueList = page('github.com', 'Issues · example/web-guide', [
  node(1, 'heading', 'Issues'), node(2, 'button', 'New issue'), issueLink,
]);

const wikipediaGoal = '把字号调成大号，并把主题切换到深色。';
function wikipedia(dark) {
  return page('en.wikipedia.org', 'Accessibility - Wikipedia', [
    node(1, 'region', 'Appearance'), node(2, 'region', 'Text', { region: 1 }),
    node(3, 'radio', 'Standard', { region: 2, checked: false }),
    node(4, 'radio', 'Large', { region: 2, checked: true }),
    node(5, 'region', 'Color', { region: 1 }),
    node(6, 'radio', 'Light', { region: 5, checked: !dark }),
    node(7, 'radio', 'Dark', { region: 5, checked: dark }),
  ]);
}

const snapshots = [
  {
    name: '入口已可见', goal: figmaGoal, sources: ['point'],
    page: page('www.figma.com', 'Practice - Figma', [frame, frameProperties, frameExport, exportButton,
      pageExport, node(6, 'button', exportButton.label, { region: pageExport.id })]),
    checks: [[label(exportButton), label(frameExport)]], target: exportButton.id,
  },
  ...(pointProtocol ? [{
    name: 'Issue 入口已可见', goal: '帮我找到 GitHub 第 42 号 Issue 的入口。', sources: ['point'],
    page: issueList, checks: [[label(issueLink)]], target: issueLink.id,
  }] : []),
  {
    name: '入口可见但尚未到达', goal: githubGoal, sources: [implemented ? 'arrival' : 'page'],
    page: issueList,
    next: issueLink.id,
  },
  {
    name: '已到达目标界面', goal: githubGoal, sources: [implemented ? 'arrival' : 'page'],
    page: page('github.com', issueTitle + ' · example/web-guide',
      implemented ? [issueDetails, ...issueNodes.map(item => ({ ...item, region: issueDetails.id }))] : issueNodes),
    checks: [[label(issueHeading)]], oneOf: [label(issueEditor), label(issueEditButton)],
  },
  {
    name: '只完成一项', goal: wikipediaGoal, sources: ['page', 'page'],
    page: wikipedia(false), next: 7,
  },
  {
    name: '两项均已完成', goal: wikipediaGoal, sources: ['page', 'page'],
    page: wikipedia(true), checks: [[check(4, 'checked', true)], [check(7, 'checked', true)]],
  },
];

const sameCheck = (left, right) => left.id === right.id && left.field === right.field && left.equals === right.equals;
function assess(snapshot, input, reply) {
  const decision = validateDecision(reply, input);
  const sources = decision?.requirements?.map(item => item.source) ?? [];
  const expectedSources = JSON.stringify(sources) === JSON.stringify(snapshot.sources);
  const proofs = decision?.proofs ?? [];
  // 单次回放只评价提交的证明。网页实际画出蓝框仍由浏览器验证。
  const allProved = sources.length > 0 && sources.every((source, index) => source !== 'user'
    && proofs.some(proof => proof.index === index && proof.checks.every(claim => {
      const evidence = input.page.nodes.find(item => item.id === claim.id);
      return evidence?.viewport && evidence[claim.field] === claim.equals;
    })));
  const satisfiesGoal = !!snapshot.checks && allProved && expectedSources
    && snapshot.checks.every((checks, index) => proofs.some(proof => proof.index === index
      && (snapshot.target === undefined || proof.targetId === snapshot.target)
      && checks.every(expected => proof.checks.some(claim => sameCheck(claim, expected)))
      && (!snapshot.oneOf || snapshot.oneOf.some(expected => proof.checks.some(claim => sameCheck(claim, expected))))));
  return { kind: reply?.kind, targetId: reply?.targetId, conditions: reply?.requirements, sources, expectedSources,
    submitted: reply?.proofs, acceptedProofs: proofs.length, allProved, satisfiesGoal,
    premature: !snapshot.checks && allProved,
    next: snapshot.next === undefined ? undefined : decision?.kind === 'highlight' && decision.targetId === snapshot.next };
}

for (const [index, round] of [1, 2].entries()) {
  for (const [position, snapshot] of snapshots.entries()) {
    const input = { goal: snapshot.goal, page: snapshot.page, reads: [], finishOnly: false, requirements: [] };
    if (!isGuideRequest(input)) throw new Error('观察没有通过正式请求校验：' + snapshot.name);
    // 历史对照只换一段提示并交替顺序。实现版直接使用当前 API，两种模式都关闭经验。
    const variants = implemented ? [pointProtocol ? 'point' : 'implemented']
      : (index + position) % 2 === 0 ? ['current', 'candidate'] : ['candidate', 'current'];
    for (const variant of variants) {
      const started = Date.now();
      const decide = createModelGuide(config, async (url, init) => {
        if (variant !== 'candidate') return fetch(url, init);
        const body = JSON.parse(init.body);
        const system = body.messages[0].content;
        if (!system.includes(original)) throw new Error('本对照依赖原版完成提示。');
        body.messages[0].content = system.replace(original, candidate);
        return fetch(url, { ...init, body: JSON.stringify(body) });
      });
      const signal = AbortSignal.timeout(15_000);
      let result;
      try {
        result = assess(snapshot, input, await decide(input, signal));
      } catch (error) {
        if (!signal.aborted && !(error instanceof ModelRequestError)) throw error;
        result = { error: signal.aborted ? 'request-deadline' : error.failure.outcome };
      }
      console.log(JSON.stringify({ round, snapshot: snapshot.name, variant, ms: Date.now() - started, ...result }));
    }
  }
}
