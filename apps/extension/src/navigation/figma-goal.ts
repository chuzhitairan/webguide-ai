import { controlLabel, isAvailableTarget } from '../page/locator.js';

const frameName = 'Frame 1';
const layerRows = '[aria-label="Left sidebar"] [role="treegrid"] [role="row"][data-testid="layer-row"]';
const layerNameCell = '[role="gridcell"][aria-colindex="1"]';
const rightSidebar = '[aria-label="Right sidebar"]';
const sidebarHeadings = `${rightSidebar} h2`;
const enableAutoLayout = `${rightSidebar} input[type="checkbox"][data-tooltip="Use auto layout"]:enabled:not(:checked)`;
const sidebarControls = '[aria-label="Left sidebar"] :is(button,[role="button"]), [aria-label="Right sidebar"] [role="tab"]';

export const figmaGoalPrompt = '在 Figma Design 中带用户找到 Frame 1 的自动布局。'
  + '看到 Toggle auto layout 开关就高亮它，说明这是启用入口。若提供 Layout 或 Auto layout 标题，就指向对应区域。找到入口即可。'
  + '还未选中时优先指向 Frame 1；缺少图层时根据可见的 Layers 或 Design 入口指路。';

export function figmaFileAt(address?: string): string | undefined {
  if (!address) return;
  try {
    const url = new URL(address);
    if (url.origin === 'https://www.figma.com') return /^\/design\/([a-z\d]+)(?:\/|$)/i.exec(url.pathname)?.[1];
  } catch {
    return;
  }
}

export function observeFigmaGoal(document: Document): { candidates: Element[]; destination?: Element } {
  const controls = [...document.querySelectorAll(sidebarControls)].filter(element => {
    const label = controlLabel(element);
    return (label === 'Layers' || (label === 'Design' && element.getAttribute('aria-selected') !== 'true'))
      && isAvailableTarget(element, document);
  });
  const rows = [...document.querySelectorAll(layerRows)].filter(row => isAvailableTarget(row, document));
  // Figma 的图标和图层名称可能同为第 1 列。检查这一列里的所有单元格。
  const matchingRows = rows.filter(row => [...row.querySelectorAll(layerNameCell)]
    .some(cell => cell.textContent?.trim() === frameName));
  if (matchingRows.length !== 1) return { candidates: controls };

  // 图层行已经出现，继续打开 Layers 不会推进这个任务。
  const navigation = controls.filter(element => controlLabel(element) !== 'Layers');
  const [frame] = matchingRows;
  const selected = rows.filter(row => row.getAttribute('aria-selected') === 'true');
  if (selected.length !== 1 || selected[0] !== frame) return { candidates: [...navigation, frame] };

  // 确认选中目标图层后再找右侧标题。普通 Frame 未启用自动布局时显示 Layout。
  const headings = [...document.querySelectorAll(sidebarHeadings)].filter(heading => isAvailableTarget(heading, document));
  let destinations = headings.filter(heading => heading.textContent?.trim() === 'Auto layout');
  if (!destinations.length) {
    // 透明复选框接收点击，与它关联的 label 才是用户看到的图标。
    const enableIcons = [...document.querySelectorAll<HTMLInputElement>(enableAutoLayout)]
      .flatMap(input => [...(input.labels ?? [])])
      .filter(label => label.closest(rightSidebar) && isAvailableTarget(label, document));
    destinations = enableIcons.length === 1 ? enableIcons
      : headings.filter(heading => heading.textContent?.trim() === 'Layout');
  }
  const destination = destinations.length === 1 ? destinations[0] : undefined;
  return { candidates: destination ? [...navigation, destination] : navigation, destination };
}
