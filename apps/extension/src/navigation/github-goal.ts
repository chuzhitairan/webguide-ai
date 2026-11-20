import { controlLabel, isAvailableTarget, isVisibleTarget } from '../page/locator.js';
import type { BoundGoal, Goal, PagePhase } from './protocol.js';

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

export function bindGoal(address: string | undefined, goal: Goal): BoundGoal | undefined {
  const repo = repositoryAt(address);
  if (!repo) return;
  if (goal.kind !== 'issue') return { ...goal, repo };
  if (!validIssueNumber(goal.number)) return;
  const issueNumber = String(Number(goal.number));
  return { kind: 'issue', repo, number: issueNumber, path: repo + '/issues/' + issueNumber };
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

function readmePath(path: string | undefined, repo: string, action: 'blob' | 'edit'): boolean {
  if (!path || !path.toLowerCase().startsWith(repo.toLowerCase() + '/')) return false;
  const [operation, branch, filename, ...rest] = path.slice(repo.length + 1).split('/');
  return operation === action && !!branch && /^README\.md$/i.test(filename ?? '') && rest.length === 0;
}

function editName(element: Element): boolean {
  return /^edit (?:this )?file$/i.test(controlLabel(element));
}

export function isReadmeEditTarget(element: Element, url: URL, repo: string): boolean {
  if (url.origin !== githubOrigin || !readmePath(url.pathname, repo, 'blob')) return false;
  const href = element.getAttribute('href');
  if (href) {
    try {
      const destination = new URL(href, url);
      // 分支与文件必须和正在浏览的 README 一致。
      return destination.origin === url.origin
        && destination.pathname.slice(0, repo.length).toLowerCase() === repo.toLowerCase()
        && destination.pathname.slice(repo.length) === url.pathname.slice(repo.length).replace('/blob/', '/edit/')
        && isAvailableTarget(element, element.ownerDocument);
    } catch {
      return false;
    }
  }
  return !!element.closest('main, [role="menu"]') && !element.closest('.markdown-body')
    && editName(element) && isAvailableTarget(element, element.ownerDocument);
}

export function isPreferredControl(element: Element, path: string | undefined, url: URL, goal: BoundGoal): boolean {
  if (goal.kind === 'issue') return path?.toLowerCase() === goal.path.toLowerCase();
  return readmePath(path, goal.repo, 'blob') || readmePath(path, goal.repo, 'edit')
    || (readmePath(url.pathname, goal.repo, 'blob') && /^(?:edit (?:this )?file|more edit options)$/i.test(controlLabel(element)))
    || (readmePath(url.pathname, goal.repo, 'edit') && /^Fork this repository$/i.test(controlLabel(element)));
}

function readmeNeedsSignIn(document: Document, url: URL, repo: string): boolean {
  const signIn = [...document.querySelectorAll('header a[href^="/login"], [role="banner"] a[href^="/login"]')]
    .some(link => /^sign in$/i.test(controlLabel(link)) && isVisibleTarget(link, document));
  if (!signIn) return false;
  const menu = [...document.querySelectorAll('button[aria-expanded="true"]')].some(button =>
    (button.getAttribute('data-testid') === 'more-edit-button' || /^more edit options$/i.test(controlLabel(button)))
    && isVisibleTarget(button, document));
  if (!menu) return false;
  // 匿名页面的编辑菜单可能只出现 GitHub Desktop。先找真实的网页编辑控件，再提示登录。
  return ![...document.querySelectorAll('a[href], button, [role="menuitem"]')]
    .some(element => isReadmeEditTarget(element, url, repo));
}

export function inspectGoal(document: Document, url: URL, goal: BoundGoal): PagePhase {
  if (goal.kind === 'issue') {
    if (url.pathname.replace(/\/$/, '').toLowerCase() !== goal.path.toLowerCase()) return 'guide';
    return reachedIssue(document, url, goal.path) ? 'arrived' : 'waiting-issue';
  }
  if (readmePath(url.pathname, goal.repo, 'blob') && readmeNeedsSignIn(document, url, goal.repo)) return 'login-required';
  if (!readmePath(url.pathname, goal.repo, 'edit')) return 'guide';

  // 检查编辑页本身的提示。仓库首页一直存在的 Fork 菜单不表示当前缺少写权限。
  const forkNotice = [...document.querySelectorAll('main :is(h1,h2,h3,[role="heading"])')].some(heading =>
    /^You need to fork this repository to propose changes\.?$/i.test(heading.textContent?.trim() ?? '')
    && isVisibleTarget(heading, document));
  if (forkNotice) return 'fork-required';

  const editable = [...document.querySelectorAll('main .cm-editor .cm-content[contenteditable="true"]')]
    .some(element => isAvailableTarget(element, document));
  if (!editable) return 'waiting-editor';
  // 只在页面里验证文件名；编辑器内容和输入值不会放进模型快照。
  const fileName = [...document.querySelectorAll<HTMLInputElement>(
    'main input[aria-label="File name" i], main input[aria-label="Filename" i], main input[name="filename"]',
  )].some(input => /^README\.md$/i.test(input.value) && isVisibleTarget(input, document));
  const blobPath = url.pathname.replace('/edit/', '/blob/');
  const fileLink = [...document.querySelectorAll<HTMLAnchorElement>('main a[href]')].some(link =>
    link.origin === url.origin && link.pathname === blobPath && isVisibleTarget(link, document));
  return fileName || fileLink ? 'arrived' : 'waiting-editor';
}

export function goalPrompt(goal: BoundGoal, phase: PagePhase): string {
  if (goal.kind === 'issue') {
    return ('在 GitHub 仓库 ' + goal.repo + ' 打开 Issue #' + goal.number + '。优先使用该仓库的 Issues 入口和列表。').slice(0, 200);
  }
  if (phase === 'fork-required') {
    return '用户想进入 README 编辑器。当前编辑页已明确提示先 Fork。请说明 Fork 会创建仓库副本；如果用户愿意继续，可以指出页面上的 Fork this repository 按钮。';
  }
  const destination = goal.kind === 'readme-entry' ? '找到编辑入口' : '进入编辑器';
  return '为当前 GitHub 仓库根目录的 README.md ' + destination
    + '。仓库首页优先找 README.md 文件链接。在文件页找文件工具栏的编辑控件；如果藏在菜单里，先指向对应菜单。只有明确提示时才提 Fork。';
}
