import type { FixtureCollaborationTarget } from '../../../../../packages/contracts/src/types.js';
import { fixtureOrigins } from '../../../../../tests/fixtures/collaboration/capabilities.js';
export { fixtureCapabilities } from '../../../../../tests/fixtures/collaboration/capabilities.js';

// 两个本机端口共享模拟仓库。对象键不含端口，因此同一不可变版本可从另一标签页补证。
export const fixtureRoleKinds: Readonly<Record<string, string>> = {
  issue: 'fixture.issue', 'repository-branch': 'fixture.branch', 'repository-file': 'fixture.file',
  'file-editor': 'fixture.editor', commit: 'fixture.commit', comparison: 'fixture.comparison',
  'pull-request': 'fixture.pr', 'pull-request-files': 'fixture.diff', 'pull-request-commits': 'fixture.pr-commits',
};
export const isFullSha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const fixtureKey = (repo: string, role: string, ...parts: string[]) => JSON.stringify([repo, role, ...parts]);

export function identifyFixtureUrl(address: string, target?: FixtureCollaborationTarget) {
  let url: URL;
  try { url = new URL(address); } catch { return null; }
  const repo = target?.repo ?? 'fixture-team/guide';
  if (url.username || url.password || !fixtureOrigins.some(origin => origin === url.origin)
      || (target && !target.origins.includes(url.origin))) return null;
  const [owner, name, route, ...rest] = url.pathname.slice(1).split('/');
  if (repo !== 'fixture-team/guide' || owner + '/' + name !== repo || rest.length) return null;
  const get = (key: string) => url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key)! : '';
  const page = (pageRole: string, ...parts: string[]) => ({origin:url.origin, pageRole, objectKey: fixtureKey(repo,pageRole,...parts)});
  const number = get('number'), branch = get('branch'), path = get('path'), base = get('base'), head = get('head'), side = get('side');
  const isNumber = /^[1-9]\d*$/.test(number) && Number.isSafeInteger(Number(number));
  const isPath = path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(p => !p || p === '.' || p === '..')
    && (!target || path === target.documentPath);
  switch (route) {
    case 'issue': return isNumber && (!target || target.issueNumber === Number(number)) ? page('issue',number) : null;
    case 'repository': return branch ? page('repository-branch',branch) : null;
    case 'file':
      if (!isPath) return null;
      if (branch && !base && !head && !side) return page('repository-file',branch,path);
      return !branch && isFullSha(base) && isFullSha(head) && (side === 'base' || side === 'head')
        ? page('repository-file',base,head,path,side) : null;
    case 'editor': return isPath && branch ? page('file-editor',branch,path) : null;
    case 'commit': return isFullSha(get('sha')) ? page('commit',get('sha')) : null;
    case 'compare': return base && head && isFullSha(get('baseSha')) && isFullSha(get('headSha'))
      ? page('comparison',get('baseSha'),get('headSha')) : null;
    case 'pr': return isNumber ? page('pull-request',number) : null;
    case 'pr-files': return isNumber && isFullSha(base) && isFullSha(head) ? page('pull-request-files',number,base,head) : null;
    case 'pr-commits': return isNumber && isFullSha(head) ? page('pull-request-commits',number,head) : null;
    default: return null;
  }
}
