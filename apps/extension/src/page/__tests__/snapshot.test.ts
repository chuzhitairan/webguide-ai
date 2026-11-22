// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readPage } from '../snapshot.js';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 120, 24));
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('观察可操作控件，保留可访问名称，从摘要中省略输入值和链接查询参数', () => {
  document.body.innerHTML = '<main><h1>Projects</h1><span id="menu">Navigation</span>'
    + '<button aria-labelledby="menu" aria-expanded="true"><svg></svg></button><button hidden>Hidden</button>'
    + '<button disabled>Disabled</button><input value="private"><input type="search" aria-label="Search projects" value="private query">'
    + '<a href="https://example.com/projects/recent?q=private">Recent projects</a></main>';
  const { page, elements } = readPage(document, new URL('https://example.com/projects?token=private'));
  expect(page).toEqual({ path: '/projects', title: 'Projects', controls: [
    { id: 1, label: 'Navigation', role: 'button', region: 'main', expanded: true },
    { id: 2, label: 'Search projects', role: 'textbox', region: 'main' },
    { id: 3, label: 'Recent projects', role: 'link', region: 'main', path: '/projects/recent' },
  ] });
  expect(elements.get(1)).toBe(document.querySelector('button'));
});
