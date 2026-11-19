import { useEffect, useRef, useState } from 'react';
import type { SessionCheckpoint } from '@webguide/contracts';
import { connectSession } from './session-client.js';
import type { PanelState } from './session-client.js';

const startUrl = 'http://127.0.0.1:43131/fixture-team/guide/issue?number=1';
const stateLabels: Record<SessionCheckpoint['state'], string> = {
  ready: '待开始', checking: '正在核对', guiding: '请按提示操作', waiting: '等待结果',
  blocked: '需要处理', pending: '待确认', paused: '已暂停', ended: '已结束',
};
const reasons: Record<string, string> = {
  'submission-verified': '本段提交已验证',
  'checks-failed': 'CI 检查失败，需处理',
  'review-changes-requested': '评审请求修改，需处理',
  'confirm-anchor': '请确认刚保存的提交版本',
  'pr-draft': '这是草稿 PR，尚未交接评审',
  'pr-closed': 'PR 已关闭',
  'historical-merged': '此 PR 已合并，可查看历史结果',
  'read-incomplete': '还需打开页面查看完整证据',
  'evidence-missing': '请按练习页链接打开待核对的内容',
  'evidence-stale': '请重新打开相关练习页核对最新结果',
  'page-required': '请打开当前步骤对应的练习页',
  'action-required': '请在网页上完成这一步',
  'input-not-saved': '文字已写好，请保存到工作分支',
  'correct-commit-destination': '请选择提交到当前工作分支',
  'check-timeout': '读取超时，请重新核对当前页',
  'unexpected-edit': '保存的内容和本次练习要求不同',
  'object-mismatch': '当前仓库、分支、文件或 PR 与练习不符',
  'location-unavailable': '当前页还找不到可以指示的控件',
  'ambiguous-target': '当前页有多个可能的操作位置，请核对页面',
  'recovery-required': '请继续练习并重新核对页面',
  'anchor-changed': '提交版本发生变化，请重新核对',
  'store-failed': '保存进度失败，练习已暂停',
};

function explain(reason: string): string {
  return reasons[reason] ?? '请按当前步骤核对练习页。';
}

const evidenceLabels: Record<string, string> = {
  issue: '任务指派', commit: '本次保存的提交', 'repository-branch': '工作分支',
  'branch source': '工作分支的创建来源', 'repository-file': '提交页链接中的 base 和 head 源码',
  'file-editor': '文档编辑页', 'pull-request': '实际 PR 页面', 'bound pull-request': '实际 PR 页面',
  'pull-request-files': 'PR 的文件差异页', 'pull-request-commits': 'PR 的提交列表页',
  comparison: '分支比较页', 'confirmed commit': '本次提交版本',
};

export function App() {
  return __WEBGUIDE_FIXTURE__ ? <PracticeApp /> : <main className="panel">
    <header><span>WebGuide AI</span><h1>网页任务引导</h1></header>
    <p>真实站点教程会在适配完成后开放。</p>
  </main>;
}

function PracticeApp() {
  const [view, setView] = useState<PanelState | null>(null);
  const [message, setMessage] = useState('');
  const [marker] = useState(() => 'WG-FIXTURE-' + crypto.randomUUID().slice(0, 8).toUpperCase());
  const client = useRef<ReturnType<typeof connectSession> | null>(null);

  useEffect(() => {
    setMessage('正在连接本机扩展…');
    client.current = connectSession(setView, setMessage);
    return () => client.current?.dispose();
  }, []);

  const snapshot = view?.snapshot;
  const target = snapshot?.target;
  const edit = target?.profile === 'fixture_collaboration_v1'
    ? target.expectedEdit.after : '已完成协作练习 ' + marker + '。';
  const finished = snapshot?.state === 'ended';
  const stopped = finished || snapshot?.state === 'paused';
  const missingEvidence = [...new Set(snapshot?.decision?.missing.map(item => evidenceLabels[item]).filter(Boolean) ?? [])];

  return <main className="panel">
    <header><span>WebGuide AI</span><h1>GitHub 协作练习</h1></header>
      <p className="intro">在本机模拟仓库走一遍认领、修改文档和提交 PR。所有操作由你在网页上完成。</p>
      {message && <p className="notice" role="status">{message}</p>}
      {!snapshot && <section className="card" aria-label="练习任务">
        <h2>修改一份练习说明</h2>
        <p>仓库 fixture-team/guide · Issue #1 · 成员 fixture-user</p>
        <p>从 main 建立分支，修改 <code>docs/practice/first-pr.md</code>，再提交普通 PR。</p>
        <p><a href={startUrl} target="_blank" rel="noreferrer">打开练习页</a></p>
        <button className="primary" disabled={!view} onClick={() => client.current?.send('USER_START', {
          tutorialId: 'fixture.collaboration.first-pr', version: '0.1.0-draft', practiceMarker: marker,
        })}>开始练习</button>
      </section>}
      {snapshot && <section className="card" aria-label="当前进度">
        <p className="state" role="status" data-testid="session-state" data-state={snapshot.state}>{stateLabels[snapshot.state]}</p>
        <p className="step-index">{view?.stepIndex ?? 0} / {view?.stepCount ?? 0} 步{snapshot.navigationIntent === 'review' && ' · 回看'}</p>
        <h2 data-testid="step-title">{view?.step?.title ?? '核对当前任务'}</h2>
        {view?.step && <p>{view.step.instruction}</p>}
        {snapshot.result === 'system-verified' && <p className="success" data-testid="result">开发模拟提交已验证</p>}
        {snapshot.result === 'incomplete' && <p data-testid="result">练习已退出，提交未验证</p>}
        {snapshot.decision?.reasonCodes.length ? <ul className="evidence">
          {[...new Set(snapshot.decision.reasonCodes.map(explain))].map(reason => <li key={reason}>{reason}</li>)}
        </ul> : null}
        {missingEvidence.length > 0 && <p className="muted">还需核对 {missingEvidence.join('、')}。</p>}
        {view?.evidenceTime && <p className="muted">最近证据：{new Date(view.evidenceTime).toLocaleTimeString()}</p>}
        {target?.profile === 'fixture_collaboration_v1' && target.prBinding &&
          <p><a href={target.prBinding.url} target="_blank" rel="noreferrer">查看练习 PR #{target.prBinding.number}</a></p>}
        {snapshot.stopStatus.pendingBindings.length > 0 && <p className="muted">正在等待页面确认停止。</p>}
        {snapshot.decision?.commitCandidate && !stopped && <button className="primary" onClick={() =>
          client.current?.send('USER_CONFIRM_ANCHOR', { sha: snapshot.decision?.commitCandidate?.sha })}>确认这次提交</button>}
        {snapshot.state === 'paused' && <button className="primary" onClick={() => client.current?.send('USER_CONTINUE')}>继续并重新核对</button>}
        {!stopped && <div className="actions">
          <button onClick={() => client.current?.send('USER_RECHECK')}>重新核对</button>
          <button onClick={() => client.current?.send('USER_PAUSE')}>暂停</button>
          <button onClick={() => client.current?.send('USER_BACK')}>回看上一步</button>
          {snapshot.navigationIntent === 'review' && <button onClick={() => client.current?.send('USER_ADVANCE')}>回到当前进度</button>}
        </div>}
        {!finished && <button className="link-button" onClick={() => client.current?.send('EXIT')}>退出练习</button>}
      </section>}
      <section className="practice" aria-label="练习文字">
        <h2>本次要保存的文字</h2><p data-testid="expected-edit">{edit}</p>
      </section>
  </main>;
}
