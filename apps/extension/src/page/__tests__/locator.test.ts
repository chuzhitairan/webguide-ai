// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAvailableTarget, isVisibleTarget } from '../locator.js';
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

describe('page targets', () => {
  it('requires a visible element attached to the current document', () => {
    document.body.innerHTML = '<button hidden></button><section style="display:none"><button></button></section><button></button>';
    const [hidden, hiddenByParent, visible] = document.querySelectorAll('button');
    expect(isVisibleTarget(hidden, document)).toBe(false);
    expect(isVisibleTarget(hiddenByParent, document)).toBe(false);
    expect(isVisibleTarget(visible, document)).toBe(true);
    visible.remove();
    expect(isVisibleTarget(visible, document)).toBe(false);
  });

  it('excludes disabled controls and controls from the guide itself', () => {
    document.body.innerHTML = '<fieldset disabled><legend><button></button></legend><button></button></fieldset>'
      + '<div aria-disabled="true"><button></button></div><div class="webguide-popover"><button></button></div>';
    const [available, disabled, ariaDisabled, popover] = document.querySelectorAll('button');
    expect(isAvailableTarget(available, document)).toBe(true);
    expect(isAvailableTarget(disabled, document)).toBe(false);
    expect(isAvailableTarget(ariaDisabled, document)).toBe(false);
    expect(isAvailableTarget(popover, document)).toBe(false);
  });
});

it('renders guidance markup as text and clears the guide without synthetic clicks', () => {
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
    expect(document.documentElement.classList.contains('webguide-guiding')).toBe(true);
    expect(document.querySelector('.webguide-popover button:not([style*="none"])')).toBeNull();
  } finally {
    renderer.clear();
  }
  expect(document.querySelector('.webguide-popover, .driver-overlay')).toBeNull();
  expect(document.documentElement.classList.contains('webguide-guiding')).toBe(false);
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
