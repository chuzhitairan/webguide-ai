// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readPage } from '../navigation-snapshot.js';
import { issueGoal, reachedIssue } from '../../navigation/issue-goal.js';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 120, 24));
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('观察可操作控件，保留可访问名称，并避免上传输入值和链接查询参数', () => {
  document.body.innerHTML = '<main><h1>Repo</h1><span id="menu">Navigation</span>'
    + '<button aria-labelledby="menu"><svg></svg></button><button hidden>Hidden</button>'
    + '<button disabled>Disabled</button><input value="private"><input type="search" aria-label="Search issues" value="private query">'
    + '<a href="https://github.com/octo/project/issues?q=private">Issues</a></main>';
  const { page, elements } = readPage(document, new URL('https://github.com/octo/project?token=private'), '/octo/project/issues/17');
  expect(page).toEqual({ path: '/octo/project', title: 'Repo', controls: [
    { id: 1, label: 'Navigation', role: 'button', region: 'main' },
    { id: 2, label: 'Search issues', role: 'textbox', region: 'main' },
    { id: 3, label: 'Issues', role: 'link', region: 'main', path: '/octo/project/issues' },
  ] });
  expect(elements.get(1)).toBe(document.querySelector('button'));
});

it('只在同一仓库的目标 Issue 标题可见时报告完成', () => {
  const goal = issueGoal('https://github.com/octo/project', '17')!;
  expect(goal.path).toBe('/octo/project/issues/17');
  expect(issueGoal('https://github.com/settings/profile', '17')).toBeUndefined();
  document.body.innerHTML = '<main><h1><span data-testid="issue-title">Fix navigation</span> <span>#16</span></h1></main>';
  expect(reachedIssue(document, new URL('https://github.com/octo/project/issues/17'), goal.path)).toBe(false);
  document.querySelector('h1 span:last-child')!.textContent = '#17';
  expect(reachedIssue(document, new URL('https://github.com/octo/project/issues/17'), goal.path)).toBe(true);
  expect(reachedIssue(document, new URL('https://github.com/other/project/issues/17'), goal.path)).toBe(false);
});
