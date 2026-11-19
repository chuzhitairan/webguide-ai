import type { FixtureCollaborationTarget, LocationResult } from '../../../../../packages/contracts/src/types.js';
import { identifyFixtureUrl } from './capabilities.js';

export function visible(node: Element): boolean {
  if (!node.isConnected || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
  for (let el: Element | null = node; el; el = el.parentElement) {
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
    if (el.tagName === 'DETAILS' && !el.hasAttribute('open') && !el.querySelector('summary')?.contains(node)) return false;
  }
  return true;
}

// 一个定位器可随表单阶段指向不同控件。每次只选择唯一可见目标，去向不明时不给提交按钮。
export function resolveFixtureTarget(id: string, doc: Document, target?: FixtureCollaborationTarget): LocationResult {
  const page = identifyFixtureUrl(doc.URL, target);
  const main = doc.querySelector('main[data-fixture-role]');
  if (!page || main?.getAttribute('data-fixture-role') !== page.pageRole || main.getAttribute('data-repo') !== (target?.repo ?? 'fixture-team/guide')) return {status:'unavailable'};
  const text = (css: string) => main.querySelector(css)?.textContent ?? '';
  const input = (css: string) => main.querySelector<HTMLInputElement>(css);
  let css: string | undefined;
  switch (id) {
    case 'fixture.issue-summary': css = '#issue-summary'; break;
    case 'fixture.assignees-or-assigned-status': css = main.querySelector('#assign') ? '#assign' : '#assignees'; break;
    case 'fixture.branch-menu': css = '#branch-menu'; break;
    case 'fixture.branch-name': css = '#branch-name'; break;
    case 'fixture.create-branch-or-branch-status': css = main.querySelector('#branch-status') ? '#branch-status' : '#create-branch'; break;
    case 'fixture.edit-file': css = page.pageRole === 'file-editor' ? '#document-editor' : '#edit-file'; break;
    case 'fixture.document-editor': css = '#document-editor'; break;
    case 'fixture.commit-or-saved-status': {
      if (page.pageRole === 'commit') { css = '#commit-summary'; break; }
      if (page.pageRole !== 'file-editor' || text('#current-branch') !== (target?.headBranch ?? 'practice/first-pr-001')) break;
      const form = main.querySelector('#commit-form');
      if (!form || !visible(form)) { css = '#open-commit'; break; }
      const selected = input('[name="mode"]:checked');
      if (selected?.value === 'new-branch') css = '#commit-current';
      if (selected?.value === 'current-branch') css = input('#commit-message')?.value.trim() ? '#confirm-commit' : '#commit-message';
      break;
    }
    case 'fixture.comparison-summary': css = page.pageRole === 'pull-request' ? '#pr-summary' : '#comparison-summary'; break;
    case 'fixture.pr-description': css = page.pageRole === 'pull-request' ? '#pr-summary' : input('#pr-title')?.value.trim() ? '#pr-body' : '#pr-title'; break;
    case 'fixture.create-pr-or-existing-link': css = page.pageRole === 'pull-request' ? (main.querySelector('#ready-review') ? '#ready-review' : '#pr-summary') : main.querySelector('#existing-pr') ? '#existing-pr' : '#create-pr'; break;
    case 'fixture.pr-summary': css = '#pr-summary'; break;
  }
  if (!css) return {status:'unavailable'};
  const candidates = [...main.querySelectorAll(css)].filter(visible);
  if (candidates.length !== 1) return {status:candidates.length ? 'ambiguous' : 'missing'};
  const element = candidates[0];
  return element.matches(':disabled,[aria-disabled="true"]') ? {status:'unavailable'} : {status:'found',element};
}
