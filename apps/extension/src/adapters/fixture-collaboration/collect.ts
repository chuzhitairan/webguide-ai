import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { CheckRequest, FixtureCollaborationTarget, ObservationPayloadResult } from '../../../../../packages/contracts/src/types.js';
import { fixtureCapabilities, fixtureRoleKinds, identifyFixtureUrl, isFullSha } from './capabilities.js';
import { resolveFixtureTarget, visible } from './locators.js';

const encode = new TextEncoder();
const limit = 128 * 1024;
const lf = (value: string) => value.replaceAll('\r\n','\n');
const hash = (value: string) => bytesToHex(sha256(encode.encode(value)));
class Incomplete extends Error {}
const requireRead = (condition: unknown, reason = 'read-incomplete') => { if (!condition) throw new Incomplete(reason); };

// PR 正文只输出是否引用目标 Issue。先屏蔽代码、其他仓库和链接内的编号，避免把示例当引用。
export function matchesIssueReference(body: string, target: FixtureCollaborationTarget): boolean {
  const lines: string[] = [];
  let fence: string | undefined;
  for (const line of body.split(/\r?\n/)) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (fence) {
      if (mark?.[0] === fence[0] && mark.length >= fence.length && line.trim() === mark) fence = undefined;
    } else if (mark) fence = mark;
    else if (!/^(?: {4}|\t)/u.test(line)) lines.push(line);
  }
  const prose = lines.join('\n').replace(/(`+)[\s\S]*?\1/gu,' ');
  const tokens = prose.matchAll(/https?:\/\/[^\s<>()\[\]。，、；]+|(?<![\w/.\\#-])(?:[\w.-]+\/[\w.-]+)?#[1-9]\d*(?![\w-])/gu);
  for (const [raw] of tokens) {
    const ref = raw.replace(/[.,;!]+$/u,'');
    if (ref === '#' + target.issueNumber || ref.toLowerCase() === target.repo.toLowerCase() + '#' + target.issueNumber) return true;
    if (ref === 'https://github.com/' + target.repo + '/issues/' + target.issueNumber) return true;
    if (identifyFixtureUrl(ref,target)?.pageRole === 'issue') return true;
  }
  return false;
}

function summarizeSource(root: Element, params: URLSearchParams, target: FixtureCollaborationTarget) {
  const path = params.get('path'), side = params.get('side'), baseSha = params.get('base'), headSha = params.get('head');
  const el = root.querySelector<HTMLElement>('#source'), commitSha = root.querySelector('#commit-sha')?.textContent;
  requireRead(el && visible(el) && el.dataset.view === 'code' && el.dataset.complete === 'true');
  requireRead(root.querySelector('#file-path')?.textContent === path && commitSha === (side === 'base' ? baseSha : headSha),'object-mismatch');
  requireRead(el!.childElementCount === 0 && el!.dataset.bytes !== undefined && el!.dataset.lines !== undefined);
  const raw = el!.textContent ?? '', bytes = encode.encode(raw).length;
  const source = lf(raw), byteLength = encode.encode(source).length;
  requireRead(bytes <= limit && byteLength <= limit,'file-too-large');
  requireRead(String(bytes) === el!.dataset.bytes && String(source.split('\n').length) === el!.dataset.lines
    && String(source.endsWith('\n')) === el!.dataset.trailingLf);
  const common = {path,side,baseSha,headSha,commitSha,complete:true,byteLength,contentHash:hash(source)};
  if (side !== 'base') return common;
  const before = lf(target.expectedEdit.before), after = lf(target.expectedEdit.after);
  requireRead(before && after && target.expectedEdit.practiceMarker);
  const beforeCount = source.split(before).length - 1;
  return {...common,beforeCount,markerAbsent:!source.includes(target.expectedEdit.practiceMarker),
    expectedHeadHash:beforeCount === 1 ? hash(source.replace(before,() => after)) : null};
}

function readPage(role: string, root: Element, url: URL, target: FixtureCollaborationTarget): Record<string,unknown> {
  const p = url.searchParams;
  const el = (css: string): HTMLElement => {
    const nodes = [...root.querySelectorAll<HTMLElement>(css)].filter(visible);
    if (nodes.length !== 1) throw new Incomplete('read-incomplete');
    return nodes[0];
  };
  const val = (css: string) => (el(css) as HTMLInputElement).value;
  const text = (css: string) => el(css).textContent ?? '';
  const complete = (css: string) => el(css).dataset.complete === 'true';
  const items = (css: string) => [...el(css).querySelectorAll('li')].map(li => li.textContent ?? '');
  const files = () => [...el('#files').querySelectorAll<HTMLElement>('li')].map(li => ({path:li.dataset.path,oldPath:li.dataset.oldPath,status:li.dataset.status}));
  const sha = (css: string) => { const value = text(css); requireRead(isFullSha(value)); return value; };
  const number = Number(p.get('number'));
  switch (role) {
    case 'issue': {
      requireRead(text('#issue-number') === String(number),'object-mismatch');
      return {number,state:text('#issue-state'),assigneesComplete:complete('#assignees'),assignees:items('#assignees'),loggedInMember:text('#member')};
    }
    case 'repository-branch': {
      const branch = text('#current-branch');
      requireRead(branch === p.get('branch'),'object-mismatch');
      const open = root.querySelector('#branch-details')?.hasAttribute('open') ?? false;
      return {branch,headSha:sha('#branch-sha'),sourceBranch:text('#source-branch'),sourceSha:sha('#source-sha'),
        createdFromSource:!!root.querySelector('#branch-status'),formOpen:open,
        nameMatches:open && val('#branch-name') === target.headBranch,
        collision:open ? items('#branches').includes(val('#branch-name')) : null};
    }
    case 'repository-file':
      if (p.has('branch')) {
        const branch = text('#current-branch'), path = text('#file-path');
        requireRead(branch === p.get('branch') && path === p.get('path'),'object-mismatch');
        return {branch,path,commitSha:sha('#commit-sha'),immutable:false};
      }
      return summarizeSource(root,p,target);
    case 'file-editor': {
      const branch = text('#current-branch'), path = text('#file-path'), editor = el('#document-editor') as HTMLTextAreaElement;
      requireRead(branch === p.get('branch') && path === p.get('path'),'object-mismatch');
      const original = lf(editor.defaultValue), before = lf(target.expectedEdit.before);
      const expected = original.split(before).length === 2 && !original.includes(target.expectedEdit.practiceMarker)
        ? original.replace(before,() => lf(target.expectedEdit.after)) : null;
      const dialog = root.querySelector('#commit-form'), opened = !!dialog && visible(dialog);
      const mode = opened ? root.querySelector<HTMLInputElement>('[name="mode"]:checked')?.value : undefined;
      const commitMode = mode === 'current-branch' || mode === 'new-branch' ? mode : 'unknown';
      return {branch,path,contextMatches:branch === target.headBranch && path === target.documentPath,editorReadable:true,
        dirty:editor.value !== editor.defaultValue,previewMatches:lf(editor.value) === expected,formStage:opened ? 'dialog' : 'editing',
        commitMode,destinationBranch:commitMode === 'current-branch' ? branch : commitMode === 'new-branch' ? val('#new-branch-name') : null,
        modeEditable:!root.querySelector<HTMLInputElement>('#commit-current')?.disabled};
    }
    case 'commit': {
      const version = sha('#commit-sha'); requireRead(version === p.get('sha'),'object-mismatch');
      return {sha:version,parentShas:items('#parents'),parentsComplete:complete('#parents'),branchContext:text('#current-branch'),path:text('#file-path')};
    }
    case 'comparison': {
      const baseSha = sha('#base-sha'), headSha = sha('#head-sha'),baseBranch=text('#base-branch'),headBranch=text('#head-branch');
      requireRead(baseSha === p.get('baseSha') && headSha === p.get('headSha') && baseBranch === p.get('base') && headBranch === p.get('head'),'object-mismatch');
      const existing = !!root.querySelector('#existing-pr');
      return {baseSha,headSha,baseBranch,headBranch,completeFiles:complete('#files'),files:files(),completeCommits:complete('#commits'),commitShas:items('#commits'),
        formStage:existing ? 'existing' : 'form',titlePresent:!existing && !!val('#pr-title').trim(),issueReferenceMatches:!existing && matchesIssueReference(val('#pr-body'),target)};
    }
    case 'pull-request': {
      requireRead(text('#pr-number') === String(number),'object-mismatch');
      const draft = text('#pr-type'); requireRead(draft === 'draft' || draft === 'regular');
      return {number,url:url.href,author:text('#pr-author'),baseRepo:text('#base-repo'),headRepo:text('#head-repo'),
        baseBranch:text('#base-branch'),headBranch:text('#head-branch'),baseSha:sha('#base-sha'),headSha:sha('#head-sha'),
        state:text('#pr-state'),isDraft:draft === 'draft',issueReferenceMatches:matchesIssueReference(text('#pr-description'),target),
        reviewState:text('#review-state'),checksState:text('#checks-state'),reviewRequests:items('#review-requests')};
    }
    case 'pull-request-files': {
      const baseSha = sha('#base-sha'), headSha = sha('#head-sha');
      requireRead(text('#pr-number') === String(number) && baseSha === p.get('base') && headSha === p.get('head'),'object-mismatch');
      return {number,baseSha,headSha,complete:complete('#files'),fileCount:Number(text('#file-count')),files:files()};
    }
    case 'pull-request-commits': {
      const headSha = sha('#head-sha'); requireRead(text('#pr-number') === String(number) && headSha === p.get('head'),'object-mismatch');
      return {number,headSha,complete:complete('#commits'),commitShas:items('#commits')};
    }
    default: throw new Incomplete('unsupported-role');
  }
}

// 采集请求来自协调器。再次比对真实文档 URL、对象键与角色后，才读取这一步获准的最少字段。
export function collectFixture(req: CheckRequest, doc: Document): ObservationPayloadResult {
  const kind = fixtureRoleKinds[req.pageRole] ?? 'unknown';
  const result = {kind,objectKey:req.objectKey};
  try {
    const target = req.target;
    requireRead(target.profile === 'fixture_collaboration_v1','object-mismatch');
    if (target.profile !== 'fixture_collaboration_v1') throw new Incomplete('object-mismatch');
    const page = identifyFixtureUrl(doc.URL,target), roots = doc.querySelectorAll<HTMLElement>('main[data-fixture-role]');
    const root = roots[0], checker = fixtureCapabilities.adapters.fixture_collaboration_v1.checkers[req.checkerId];
    requireRead(page && page.objectKey === req.objectKey && page.pageRole === req.pageRole
      && roots.length === 1 && root.dataset.repo === target.repo && root.dataset.fixtureRole === page.pageRole
      && checker?.readRoles.includes(req.pageRole) && checker.observationKinds.includes(kind),'object-mismatch');
    const payload = {repo:target.repo,...readPage(req.pageRole,root,new URL(doc.URL),target)};
    const hit = 'locatorId' in req.targetSpec ? resolveFixtureTarget(req.targetSpec.locatorId,doc,target) : {status:'unavailable' as const};
    const location = hit.status === 'found' ? {status:hit.status,target:{css:'#'+hit.element.id},bindingId:req.bindingId} : {status:hit.status};
    return {...result,status:'ok',payload,location};
  } catch (e) {
    return {...result,status:e instanceof Incomplete ? 'unknown' : 'read-error',reason:e instanceof Incomplete ? e.message : 'read-error',payload:{}};
  }
}
