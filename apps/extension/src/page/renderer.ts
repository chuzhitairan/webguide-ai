import { driver } from 'driver.js';
import type { ShowGuide } from '@webguide/contracts';

export interface Renderer {
  show(element: Element, copy: ShowGuide['copy']): void;
  clear(): void;
}

// Driver 只展示一次定位。按钮和快捷键均由原网页处理，教程步骤由后台核对实际结果后推进。
export function createRenderer(): Renderer {
  let ownerDocument: Document | undefined;
  const guide = driver({
    animate: false, allowScroll: true, allowClose: false, allowKeyboardControl: false,
    advanceOn: false, overlayClickBehavior: 'none', disableActiveInteraction: false,
    showButtons: [], showProgress: false, overlayOpacity: 0.12,
    stageRadius: 5, stagePadding: 4, popoverClass: 'webguide-popover',
  });
  return {
    show(element, copy) {
      ownerDocument = element.ownerDocument;
      const focused = pageFocus(ownerDocument);
      guide.highlight({
        element,
        // 保留整页普通操作。例如核对提交时，用户仍可回到隔壁的分支选项改正去向。
        allowedElements: [element.ownerDocument.body],
        popover: {
          // 库允许 HTML。固定占位符创建显示区域，来自教程的文字只写入 textContent。
          title: ' ', description: ' ',
          onPopoverRender(popover) {
            popover.title.textContent = copy.title;
            popover.description.textContent = copy.instruction;
          },
        },
      });
      focused?.focus({ preventScroll: true });
    },
    clear() {
      const focused = pageFocus(ownerDocument);
      guide.destroy();
      focused?.focus({ preventScroll: true });
      ownerDocument = undefined;
    },
  };
}

// 核对输入内容时提示可能重画。把焦点还给用户刚刚在操作的真实网页控件。
function pageFocus(document?: Document): HTMLElement | undefined {
  const element = document?.activeElement;
  if (element?.matches('input, select, textarea, button, summary, a[href], [contenteditable="true"]')
    && !element.closest('.webguide-popover')) return element as HTMLElement;
}
