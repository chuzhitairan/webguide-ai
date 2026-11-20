import { isVisibleTarget } from '../page/locator.js';

const githubOrigin = 'https://github.com';
const sitePages = new Set(['account', 'apps', 'codespaces', 'collections', 'explore', 'features', 'login',
  'marketplace', 'notifications', 'organizations', 'orgs', 'search', 'settings', 'sponsors', 'topics', 'users']);

export function repositoryAt(address?: string): string | undefined {
  if (!address) return;
  try {
    const url = new URL(address);
    if (url.origin !== githubOrigin) return;
    const match = /^\/([\w.-]+)\/([\w.-]+)(?:\/|$)/.exec(url.pathname);
    if (match && !sitePages.has(match[1].toLowerCase())) return '/' + match[1] + '/' + match[2];
  } catch {
    return;
  }
}

export function validIssueNumber(value: string): boolean {
  const number = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(number) && number > 0;
}

export function issueGoal(address: string | undefined, number: string) {
  const repo = repositoryAt(address);
  if (!repo || !validIssueNumber(number)) return;
  const issueNumber = String(Number(number));
  return { repo, number: issueNumber, path: repo + '/issues/' + issueNumber };
}

export function reachedIssue(document: Document, url: URL, issuePath: string): boolean {
  if (url.origin !== githubOrigin || url.pathname.replace(/\/$/, '').toLowerCase() !== issuePath.toLowerCase()) return false;
  const number = issuePath.split('/').at(-1);
  // GitHub 站内跳转可能先更新 URL。等可见标题和编号也匹配才算真正打开。
  for (const title of document.querySelectorAll('main [data-testid="issue-title"]')) {
    const heading = title.closest('h1, [role="heading"]');
    if (!heading || !title.textContent?.trim() || !isVisibleTarget(title, document)) continue;
    if ([...heading.querySelectorAll('span')].some(node => node.textContent?.trim() === '#' + number
      && isVisibleTarget(node, document))) return true;
  }
  return false;
}
