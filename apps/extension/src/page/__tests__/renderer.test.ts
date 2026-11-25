// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createRenderer } from '../renderer.js';

it('同一目标更新提示时保留气泡，结束后移除高亮和气泡', () => {
  const button = document.createElement('button');
  button.textContent = 'Next';
  button.getBoundingClientRect = () => new DOMRect(10, 10, 120, 24);
  button.scrollIntoView = vi.fn();
  document.body.append(button);
  button.focus();
  const renderer = createRenderer();
  try {
    renderer.show(button, { title: '下一步', instruction: '点击 Next' });
    const popover = document.querySelector('.webguide-popover');
    expect(popover?.textContent).toContain('点击 Next');
    expect(button.classList.contains('driver-active-element')).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(button.hasAttribute('aria-expanded')).toBe(false);

    renderer.show(button, { title: '下一步', instruction: '查看 <Next>' });
    expect(document.querySelector('.webguide-popover')).toBe(popover);
    expect(popover?.textContent).toContain('查看 <Next>');

    button.setAttribute('aria-expanded', 'true');
    renderer.clear();
    expect(document.querySelector('.webguide-popover')).toBeNull();
    expect(button.classList.contains('driver-active-element')).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  } finally {
    renderer.clear();
    button.remove();
  }
});
