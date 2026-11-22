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
  let stopCheckingPlacement: (() => void) | undefined;
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
      const sidebar = element.closest('aside, [role="complementary"], [aria-label="Left sidebar"], [aria-label="Right sidebar"]');
      const bounds = sidebar?.getBoundingClientRect();
      const towardRight = bounds && bounds.left + bounds.right <= window.innerWidth;
      const target = element.getBoundingClientRect();
      // 让气泡越过栏的边缘，给同栏控件留出空间。
      const inset = bounds ? (towardRight ? bounds.right - target.right : target.left - bounds.left) : 0;
      guide.setConfig({ ...guide.getConfig(), popoverOffset: bounds ? Math.max(0, inset) + 10 : undefined });
      guide.highlight({
        element,
        // 保留整页普通操作，用户可以按自己的路线继续。
        allowedElements: [element.ownerDocument.body],
        popover: {
          side: bounds ? (towardRight ? 'right' : 'left') : undefined,
          // 库接受 HTML；提示只作为纯文本写入。
          title: ' ', description: ' ',
          onPopoverRender(popover) {
            labels = popover;
            popover.title.textContent = copy.title;
            popover.description.textContent = copy.instruction;
            stopCheckingPlacement?.();
            stopCheckingPlacement = sidebar ? watchSidebarPlacement(popover.wrapper, sidebar) : undefined;
          },
        },
      });
      focused?.focus({ preventScroll: true });
    },
    clear() {
      const focused = pageFocus(ownerDocument);
      stopCheckingPlacement?.();
      stopCheckingPlacement = undefined;
      guide.destroy();
      ownerDocument?.documentElement.classList.remove('webguide-guiding');
      focused?.focus({ preventScroll: true });
      ownerDocument = undefined;
      activeElement = undefined;
      labels = undefined;
    },
  };
}

function watchSidebarPlacement(popover: HTMLElement, sidebar: Element): () => void {
  const update = () => {
    if (!popover.isConnected) return;
    const card = popover.getBoundingClientRect();
    const panel = sidebar.getBoundingClientRect();
    const overlaps = card.left < panel.right && card.right > panel.left
      && card.top < panel.bottom && card.bottom > panel.top;
    popover.classList.toggle('webguide-popover-obstructing', overlaps);
  };
  // 窄窗口里 Driver 可能把气泡移回栏内。检查实际位置，文字仍可在扩展侧栏查看。
  const position = new MutationObserver(update);
  position.observe(popover, { attributes: true, attributeFilter: ['style'] });
  const size = new ResizeObserver(update);
  size.observe(popover);
  size.observe(sidebar);
  queueMicrotask(update);
  return () => {
    position.disconnect();
    size.disconnect();
  };
}

// 提示重画后，把焦点还给用户刚刚使用的网页控件。
function pageFocus(document?: Document): HTMLElement | undefined {
  const element = document?.activeElement;
  if (element?.matches('input, select, textarea, button, summary, a[href], [contenteditable="true"]')
    && !element.closest('.webguide-popover')) return element as HTMLElement;
}
