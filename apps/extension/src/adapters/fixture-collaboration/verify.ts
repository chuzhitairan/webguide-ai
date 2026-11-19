import type { Decision, EvaluationInput, FixtureCollaborationTarget, Observation } from '../../../../../packages/contracts/src/types.js';
import { fixtureKey, fixtureRoleKinds, identifyFixtureUrl, isFullSha } from './capabilities.js';

type Status = Decision['status'];
function decision(status: Status, reasons: string[], observations: readonly Observation[] = [], missing: string[] = [], conflicts: string[] = []): Decision {
  return {status,reasonCodes:reasons,evidenceIds:[...new Set(observations.map(e => e.id))],missing,conflicts};
}
class RuleFailure extends Error {
  constructor(readonly result: Decision) { super(result.reasonCodes.join(', ')); }
}

// 规则遇到缺项立即报告补证位置。失败读取也参加“最新一条”选择，不能回退到同对象的旧成功。
class Evidence {
  private latest = new Map<string, Observation>();
  used: Observation[] = [];
  constructor(readonly target: FixtureCollaborationTarget, readonly input: EvaluationInput) {
    const identity = input.tutorialIdentity;
    const tasks = new Set<string>();
    for (const o of input.observations) {
      if (o.targetRevision !== target.targetRevision || o.tutorialIdentity.id !== identity.id ||
          o.tutorialIdentity.version !== identity.version || o.tutorialIdentity.contentHash !== identity.contentHash) continue;
      tasks.add(o.taskId);
      const previous = this.latest.get(o.objectKey);
      if (!previous || previous.observedAt <= o.observedAt) this.latest.set(o.objectKey,o);
    }
    if (tasks.size > 1) this.fail('unknown','object-mismatch','task');
  }
  fail(status: Status, reason: string, detail: string): never {
    throw new RuleFailure(decision(status,[reason],this.used,status === 'unknown' ? [detail] : [],status === 'blocked' ? [detail] : []));
  }
  expect(condition: unknown, status: Status, reason: string, detail: string) {
    if (!condition) this.fail(status,reason,detail);
  }
  newest(kind: string): Observation | undefined {
    return [...this.latest.values()].filter(o => o.kind === 'fixture.' + kind).sort((a,b) => b.observedAt - a.observedAt)[0];
  }
  read(role: string, ...parts: string[]): Observation {
    const o = this.latest.get(fixtureKey(this.target.repo,role,...parts));
    if (!o || o.kind !== fixtureRoleKinds[role]) this.fail('unknown','evidence-missing',role);
    if (o.invalidatedReason || o.expiresAt <= this.input.now || o.observedAt > this.input.now) this.fail('unknown','evidence-stale',role);
    if (o.status !== 'ok') this.fail('unknown',o.reason ?? 'read-incomplete',role);
    this.expect(o.payload.repo === this.target.repo,'unknown','object-mismatch',role);
    this.used.push(o);
    return o;
  }
  action(o: Observation, reason = 'action-required'): Decision {
    const found = o.location?.status === 'found';
    return found && this.input.intent !== 'review' ? decision('actionable',[reason],[o])
      : decision('unknown',[found ? 'review-only' : 'location-unavailable'],[o],[o.kind]);
  }
  pass(): Decision { return decision('pass',[],this.used); }
}

function checkIssue(e: Evidence, assigned: boolean) {
  const t = e.target, o = e.read('issue',String(t.issueNumber)), p = o.payload;
  e.expect(p.number === t.issueNumber && p.state === 'open' && p.loggedInMember === t.member,'blocked','object-mismatch','Issue / member');
  if (assigned) {
    e.expect(p.assigneesComplete === true && Array.isArray(p.assignees),'unknown','read-incomplete','issue assignees');
    const list = p.assignees as unknown[];
    e.expect(!list.some(a => a !== t.member),'blocked','assignee-conflict','issue assignees');
    if (!list.includes(t.member)) return o;
  }
}

function checkFiles(e: Evidence, base: unknown, head: unknown) {
  const path = e.target.documentPath;
  if (!isFullSha(base) || !isFullSha(head)) e.fail('unknown','read-incomplete','base/head SHA');
  const sides = ['base','head'].map(side => {
    const p = e.read('repository-file',base,head,path,side).payload;
    e.expect(p.baseSha === base && p.headSha === head && p.side === side && p.path === path && p.commitSha === (side === 'base' ? base : head),
      'unknown','object-mismatch',side + ' source');
    e.expect(p.complete === true && Number.isSafeInteger(p.byteLength) && Number(p.byteLength) >= 0 && Number(p.byteLength) <= 131072
      && typeof p.contentHash === 'string' && /^[a-f0-9]{64}$/.test(p.contentHash),'unknown','read-incomplete',side + ' source');
    return p;
  });
  const [original, saved] = sides;
  e.expect(original.beforeCount === 1 && original.markerAbsent === true && original.expectedHeadHash === saved.contentHash,
    'blocked','unexpected-edit',path);
}

function checkCommit(e: Evidence, sha: string) {
  const o = e.read('commit',sha), p = o.payload;
  e.expect(p.sha === sha && p.branchContext === e.target.headBranch && p.path === e.target.documentPath,'blocked','object-mismatch','commit');
  e.expect(p.parentsComplete === true && Array.isArray(p.parentShas) && p.parentShas.length && p.parentShas.every(isFullSha),'unknown','read-incomplete','commit parents');
  return o;
}

function checkList(e: Evidence, complete: unknown, list: unknown, fileCount?: unknown) {
  e.expect(complete === true && Array.isArray(list),'unknown','read-incomplete','changed files');
  const files = list as {oldPath?:unknown;path?:unknown;status?:unknown}[];
  if (fileCount !== undefined) e.expect(fileCount === files.length,'unknown','read-incomplete','changed file count');
  e.expect(files.length === 1,'blocked','extra-files','changed files');
  const f = files[0], path = e.target.documentPath;
  e.expect(f?.status === 'modified' && f.path === path && f.oldPath === path,'blocked','unexpected-edit',path);
}

function checkCommits(e: Evidence, complete: unknown, shas: unknown, head: string) {
  e.expect(complete === true && Array.isArray(shas) && shas.every(isFullSha),'unknown','read-incomplete','commit list');
  e.expect((shas as string[]).includes(head),'unknown','anchor-changed','commit list');
}
function confirmedSha(e: Evidence): string {
  const sha = e.target.commitAnchor?.sha;
  if (!isFullSha(sha)) e.fail('unknown','evidence-missing','confirmed commit');
  return sha;
}

function readPr(e: Evidence) {
  const t = e.target, n = t.prBinding?.number ?? e.newest('pr')?.payload.number;
  if (!Number.isSafeInteger(n) || Number(n) < 1) e.fail('unknown','evidence-missing','pull-request');
  const o = e.read('pull-request',String(n)), p = o.payload;
  const url = typeof p.url === 'string' && identifyFixtureUrl(p.url,t);
  e.expect(url && url.objectKey === o.objectKey && p.number === n && p.author === t.member && p.baseRepo === t.repo && p.headRepo === t.repo
    && p.baseBranch === t.baseBranch && p.headBranch === t.headBranch && t.baseBranch !== t.headBranch,'blocked','object-mismatch','PR identity');
  return o;
}

function handoff(e: Evidence): Decision {
  const t = e.target;
  if (checkIssue(e,true)) e.fail('blocked','assignee-conflict','issue assignees');
  const head = confirmedSha(e);
  checkCommit(e,head);
  e.expect(t.prBinding,'unknown','evidence-missing','bound pull-request');
  const p = readPr(e).payload;
  if (p.state === 'merged') return decision('unknown',['historical-merged'],e.used);
  if (p.state === 'closed') e.fail('blocked','pr-closed','PR state');
  e.expect(p.headSha === head,'unknown','anchor-changed','PR head');
  const base = p.baseSha;
  if (!isFullSha(base)) e.fail('unknown','read-incomplete','PR base');
  const num = String(t.prBinding!.number);
  const commits = e.read('pull-request-commits',num,head).payload;
  e.expect(commits.number === t.prBinding!.number && commits.headSha === head,'unknown','object-mismatch','PR commits');
  checkCommits(e,commits.complete,commits.commitShas,head);
  const diff = e.read('pull-request-files',num,base,head).payload;
  e.expect(diff.number === t.prBinding!.number && diff.baseSha === base && diff.headSha === head && Number.isSafeInteger(diff.fileCount),
    'unknown','object-mismatch','PR files');
  checkList(e,diff.complete,diff.files,diff.fileCount);
  checkFiles(e,base,head);
  e.expect(p.issueReferenceMatches === true,'blocked','object-mismatch','Issue reference');
  e.expect(p.state === 'open','unknown','read-incomplete','PR state');
  e.expect(p.isDraft === false,'unknown','pr-draft','ready for review');
  const reasons = ['submission-verified'];
  if (p.reviewState === 'changes-requested') reasons.push('review-changes-requested');
  if (p.checksState === 'failed') reasons.push('checks-failed');
  return decision(reasons.length === 1 ? 'pass' : 'blocked',reasons,e.used,[],reasons.slice(1));
}

function comparison(e: Evidence) {
  const head = confirmedSha(e), newest = e.newest('comparison');
  if (!newest || !isFullSha(newest.payload.baseSha) || !isFullSha(newest.payload.headSha)) e.fail('unknown','evidence-missing','comparison');
  const o = e.read('comparison',newest.payload.baseSha,newest.payload.headSha), p = o.payload;
  e.expect(p.baseBranch === e.target.baseBranch && p.headBranch === e.target.headBranch,'blocked','object-mismatch','comparison branches');
  e.expect(p.headSha === head,'unknown','anchor-changed','comparison head');
  checkCommits(e,p.completeCommits,p.commitShas,head);
  checkList(e,p.completeFiles,p.files);
  checkFiles(e,p.baseSha,head);
  return o;
}

function step(e: Evidence): Decision {
  const t = e.target, id = e.input.checkerId;
  if (id === 'fixture.issue-context' || id === 'fixture.issue-assigned') {
    const pending = checkIssue(e,id === 'fixture.issue-assigned');
    return pending ? e.action(pending) : e.pass();
  }
  if (['fixture.branch-form','fixture.branch-name-ready','fixture.branch-ready'].includes(id)) {
    const latest = e.newest('branch');
    if (!latest || typeof latest.payload.branch !== 'string') e.fail('unknown','evidence-missing','repository-branch');
    const o = e.read('repository-branch',latest.payload.branch), p = o.payload;
    if (p.branch === t.headBranch) {
      const knownSource = p.createdFromSource === true && p.sourceBranch === t.baseBranch
        && isFullSha(p.sourceSha) && isFullSha(p.headSha);
      const retainedSource = t.branchStart !== null && t.branchStart.sha === p.sourceSha;
      e.expect(knownSource || retainedSource, 'unknown', 'evidence-missing', 'branch source');
      // 创建时分支头仍等于来源提交。以后分支继续变化时沿用已确认的起点。
      if (knownSource && typeof p.sourceSha === 'string' && p.headSha === p.sourceSha) {
        return { ...e.pass(), branchStart: { sha: p.sourceSha, sourceObservationIds: [o.id] } };
      }
      return e.pass();
    }
    e.expect(p.branch === t.baseBranch && p.sourceBranch === t.baseBranch && p.sourceSha === p.headSha && isFullSha(p.sourceSha),'blocked','object-mismatch','branch source');
    if (p.formOpen !== true) return e.action(o);
    if (id === 'fixture.branch-form') return e.pass();
    e.expect(p.collision !== true,'blocked','branch-collision','branch name');
    if (p.nameMatches !== true || id === 'fixture.branch-ready') return e.action(o);
    return e.pass();
  }
  if (id === 'fixture.editor-open' || id === 'fixture.edit-context' || id === 'fixture.commit-saved') {
    const saved = e.newest('commit'), editor = e.newest('editor');
    if (saved && (id === 'fixture.commit-saved' || t.commitAnchor)) {
      if (!isFullSha(saved.payload.sha)) e.fail('unknown','read-incomplete','commit');
      const c = checkCommit(e,saved.payload.sha);
      checkFiles(e,(c.payload.parentShas as string[])[0],saved.payload.sha);
      if (t.commitAnchor?.sha !== saved.payload.sha) {
        return {...decision('unknown',[t.commitAnchor ? 'anchor-changed' : 'confirm-anchor'],e.used,['confirmed commit']),
          commitCandidate:{sha:saved.payload.sha,sourceObservationIds:e.used.map(o=>o.id)}};
      }
      return e.pass();
    }
    if (!editor && id === 'fixture.editor-open') {
      return e.action(e.read('repository-file',t.headBranch,t.documentPath));
    }
    const o = e.read('file-editor',t.headBranch,t.documentPath), p = o.payload;
    e.expect(p.contextMatches === true && p.editorReadable === true,'unknown','read-incomplete','editor');
    if (id === 'fixture.editor-open') return e.pass();
    if (id === 'fixture.edit-context') return p.previewMatches === true ? e.pass() : e.action(o);
    e.expect(p.previewMatches === true,'blocked','unexpected-edit','editor');
    if (p.formStage === 'submitting') return decision('wait',['submit-in-flight'],[o]);
    if (p.formStage === 'dialog') {
      e.expect(p.commitMode !== 'unknown','unknown','read-incomplete','commit destination');
      if (p.commitMode === 'new-branch') {
        e.expect(p.modeEditable === true,'blocked','object-mismatch','commit destination');
        return e.action(o,'correct-commit-destination');
      }
      e.expect(p.commitMode === 'current-branch' && p.destinationBranch === t.headBranch,'blocked','object-mismatch','commit destination');
    }
    return e.action(o,'input-not-saved');
  }
  if (['fixture.comparison-ready','fixture.pr-description-ready','fixture.pr-created'].includes(id)) {
    if (t.prBinding || e.newest('pr')) {
      const o = readPr(e), p = o.payload;
      const head = confirmedSha(e);
      e.expect(p.headSha === head,'unknown','anchor-changed','PR head');
      e.expect(p.issueReferenceMatches === true,'blocked','object-mismatch','Issue reference');
      if (p.state === 'merged') return decision('unknown',['historical-merged'],[o]);
      e.expect(p.state === 'open','blocked','pr-closed','PR state');
      if (id === 'fixture.comparison-ready' || p.isDraft === true) {
        const n = String(p.number);
        if (!isFullSha(p.baseSha)) e.fail('unknown','read-incomplete','PR base');
        const d = e.read('pull-request-files',n,p.baseSha,head).payload, c = e.read('pull-request-commits',n,head).payload;
        checkList(e,d.complete,d.files,d.fileCount); checkCommits(e,c.complete,c.commitShas,head); checkFiles(e,p.baseSha,head);
      }
      if (p.isDraft === true) return e.action(o,'pr-draft');
      e.expect(p.isDraft === false,'unknown','read-incomplete','PR state');
      return {...e.pass(),prCandidate:{number:Number(p.number),url:String(p.url),sourceObservationId:o.id}};
    }
    const o = comparison(e);
    if (id === 'fixture.comparison-ready') return e.pass();
    if (o.payload.formStage === 'submitting') return decision('wait',['submit-in-flight'],[o]);
    if (o.payload.formStage === 'existing') return e.action(o,'open-existing-pr');
    const ready = o.payload.titlePresent === true && o.payload.issueReferenceMatches === true;
    if (id === 'fixture.pr-description-ready') return ready ? e.pass() : e.action(o);
    if (!ready) e.fail('unknown','evidence-missing','PR title / Issue reference');
    return e.action(o);
  }
  return decision('unknown',['unsupported-checker']);
}

export function evaluateFixtureCollaboration(input: EvaluationInput): Decision {
  if (input.target.profile !== 'fixture_collaboration_v1') return decision('unknown',['unsupported-profile']);
  try {
    const e = new Evidence(input.target,input);
    return input.final || input.checkerId === 'fixture.pr-handoff' ? handoff(e) : step(e);
  } catch (error) {
    if (error instanceof RuleFailure) return error.result;
    throw error;
  }
}
