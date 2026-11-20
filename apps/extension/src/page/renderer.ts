import { driver } from 'driver.js';

export interface Renderer {
  show(element: Element, copy: { title: string; instruction: string }): void;
  clear(): void;
}

// Driver 负责画出高亮。点击和键盘操作都交给原网页。
export function createRenderer(): Renderer {
  let ownerDocument: Document | undefined;
  let activeElement: Element | undefined;
  let labels: { title: HTMLElement; description: HTMLElement } | undefined;
  const guide = driver({
    animate: false, allowScroll: true, allowClose: false, allowKeyboardControl: false,
    advanceOn: false, overlayClickBehavior: 'none', disableActiveInteraction: false,
    showButtons: [], showProgress: false, overlayOpacity: 0.12,
    stageRadius: 5, stagePadding: 4, popoverClass: 'webguide-popover',
  });
  return {
    show(element, copy) {
      if (activeElement === element && labels?.title.isConnected) {
        // 目标相同但模型换了措辞时，直接更新文字，保留正在显示的提示框。
        labels.title.textContent = copy.title;
        labels.description.textContent = copy.instruction;
        return;
      }
      ownerDocument = element.ownerDocument;
      activeElement = element;
      // 站内切页可能重写 body 的类名，遮罩样式通过根元素上的标记继续生效。
      ownerDocument.documentElement.classList.add('webguide-guiding');
      const focused = pageFocus(ownerDocument);
      guide.highlight({
        element,
        // 保留整页普通操作，用户可以按自己的路线继续。
        allowedElements: [element.ownerDocument.body],
        popover: {
          // 库接受 HTML；提示只作为纯文本写入。
          title: ' ', description: ' ',
          onPopoverRender(popover) {
            labels = popover;
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
      ownerDocument?.documentElement.classList.remove('webguide-guiding');
      focused?.focus({ preventScroll: true });
      ownerDocument = undefined;
      activeElement = undefined;
      labels = undefined;
    },
  };
}

// 提示重画后，把焦点还给用户刚刚使用的网页控件。
function pageFocus(document?: Document): HTMLElement | undefined {
  const element = document?.activeElement;
  if (element?.matches('input, select, textarea, button, summary, a[href], [contenteditable="true"]')
    && !element.closest('.webguide-popover')) return element as HTMLElement;
}
