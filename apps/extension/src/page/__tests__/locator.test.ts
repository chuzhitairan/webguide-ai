// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTarget } from '../locator.js';
import { createRenderer } from '../renderer.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

beforeEach(() => {
  // jsdom 没有排版引擎。提供一个正常按钮的几何尺寸，隐藏样式仍由真实 CSSOM 处理。
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(10, 10, 100, 30));
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('resolveTarget', () => {
  it('requires exactly one visible match after applying the exact text filter', () => {
    document.body.innerHTML = '<button hidden>Open</button><button>Open</button><button>Open menu</button>';
    const found = resolveTarget({ css: 'button', textEquals: 'Open' }, document);
    expect(found).toEqual({ status: 'found', element: document.querySelectorAll('button')[1] });
    expect(resolveTarget({ css: 'button' }, document)).toEqual({ status: 'ambiguous' });
    expect(resolveTarget({ css: 'button', textEquals: 'open' }, document)).toEqual({ status: 'missing' });
  });
  it('distinguishes missing, unavailable, and ambiguous targets without guessing', () => {
    document.body.innerHTML = '<section style="display:none"><button>Hidden</button></section><button id="zero"></button>';
    vi.spyOn(document.querySelector('#zero')!, 'getBoundingClientRect').mockReturnValue(new DOMRect());
    expect(resolveTarget({ css: 'a' }, document).status).toBe('missing');
    expect(resolveTarget({ css: 'section button' }, document).status).toBe('unavailable');
    expect(resolveTarget({ css: '#zero' }, document).status).toBe('unavailable');
    expect(resolveTarget({ css: 'button[' }, document).status).toBe('unavailable');
    expect(resolveTarget({ locatorId: 'unregistered' }, document).status).toBe('unavailable');
  });
});

it('renders tutorial markup as text and clears the guide without synthetic clicks', () => {
  const button = document.createElement('button');
  document.body.append(button);
  const click = vi.fn();
  button.addEventListener('click', click);
  const renderer = createRenderer();
  try {
    renderer.show(button, { title: '<strong>Title</strong>', instruction: '<img src=x>Click here' });
    expect(document.querySelector('.webguide-popover')?.textContent).toContain('<strong>Title</strong>');
    expect(document.querySelector('.webguide-popover')?.textContent).toContain('<img src=x>Click here');
    expect(document.querySelector('.webguide-popover img')).toBeNull();
    expect(document.querySelector('.webguide-popover button:not([style*="none"])')).toBeNull();
  } finally {
    renderer.clear();
  }
  expect(document.querySelector('.webguide-popover, .driver-overlay')).toBeNull();
  expect(click).not.toHaveBeenCalled();
});

it('leaves neighboring controls usable while a guide is visible', () => {
  // 用实际打包的样式检查命中规则；合成 click 会绕过 CSS，无法发现整页被遮罩禁用。
  const css = document.createElement('style');
  css.textContent = readFileSync(createRequire(import.meta.url).resolve('driver.js/dist/driver.css'), 'utf8');
  document.head.append(css);
  document.body.innerHTML = '<button id="target">Save</button><button id="change">Change branch</button>';
  const renderer = createRenderer();
  try {
    renderer.show(document.querySelector('#target')!, { title: 'Save', instruction: 'Confirm destination' });
    expect(getComputedStyle(document.querySelector('#change')!).pointerEvents).toBe('auto');
  } finally {
    renderer.clear();
    css.remove();
  }
});
