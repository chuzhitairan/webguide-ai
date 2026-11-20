// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bindGoal, inspectGoal, isReadmeEditTarget, isPreferredControl } from '../../navigation/github-goal.js';

const repo = 'https://github.com/octo/sample';
const file = new URL(repo + '/blob/main/README.md');
const edit = new URL(repo + '/edit/main/README.md');
const task = { kind: 'readme-editor', repo: '/octo/sample' } as const;

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 120, 24));
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('binds the explicit README goal to the repository the user is on', () => {
  expect(bindGoal(file.href, { kind: 'readme-entry' })).toEqual({ kind: 'readme-entry', repo: task.repo });
  expect(bindGoal('https://github.com/settings/profile', { kind: 'readme-editor' })).toBeUndefined();
});

it('recognizes a matching edit control only for the root README currently open', () => {
  document.body.innerHTML = '<main><button aria-label="More file actions">More</button>'
    + '<a href="' + edit.href + '">Edit file</a><span id="edit-tooltip" hidden>Edit this file</span>'
    + '<button aria-labelledby="edit-tooltip"></button>'
    + '<a href="' + repo + '/edit/other/README.md">Edit other branch</a></main>';
  const [more, editLink, editButton, otherBranch] = document.querySelectorAll('a, button');
  expect(isReadmeEditTarget(more, file, task.repo)).toBe(false);
  expect(isReadmeEditTarget(editLink, file, task.repo)).toBe(true);
  expect(isReadmeEditTarget(editButton, file, task.repo)).toBe(true);
  expect(isReadmeEditTarget(otherBranch, file, task.repo)).toBe(false);
  expect(isReadmeEditTarget(editButton, new URL(repo + '/blob/main/docs/README.md'), task.repo)).toBe(false);
  expect(isPreferredControl(editLink, file.pathname, new URL(repo), task)).toBe(true);
});

it('tells apart a loading edit page, a real Fork prompt and an editable README', () => {
  document.body.innerHTML = '<main><h1>README.md</h1><a href="' + repo + '/fork">Fork</a></main>';
  expect(inspectGoal(document, edit, task)).toBe('waiting-editor');
  expect(inspectGoal(document, new URL(repo), task)).toBe('guide');
  document.body.innerHTML = '<main><h2>You need to fork this repository to propose changes.</h2>'
    + '<button>Fork this repository</button></main>';
  expect(inspectGoal(document, edit, task)).toBe('fork-required');
  expect(inspectGoal(document, new URL(repo), task)).toBe('guide');
  document.body.innerHTML = '<main><input aria-label="File name" value="LICENSE">'
    + '<div class="cm-editor"><div class="cm-content" contenteditable="true">draft</div></div></main>';
  expect(inspectGoal(document, edit, task)).toBe('waiting-editor');
  document.querySelector('input')!.value = 'README.md';
  expect(inspectGoal(document, edit, task)).toBe('arrived');
  document.querySelector('.cm-content')!.setAttribute('contenteditable', 'false');
  expect(inspectGoal(document, edit, task)).toBe('waiting-editor');
});

it('asks for sign-in only when the open edit menu has no browser edit action', () => {
  document.body.innerHTML = '<header><a href="/login?return_to=readme">Sign in</a></header>'
    + '<main><button data-testid="more-edit-button" aria-expanded="false">More edit options</button></main>';
  expect(inspectGoal(document, file, task)).toBe('guide');
  document.querySelector('button')!.setAttribute('aria-expanded', 'true');
  expect(inspectGoal(document, file, task)).toBe('login-required');
  document.querySelector('main')!.insertAdjacentHTML('beforeend', '<a href="' + edit.href + '">Edit this file</a>');
  expect(inspectGoal(document, file, task)).toBe('guide');
});
