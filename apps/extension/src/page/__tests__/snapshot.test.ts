// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createObservation } from '../snapshot.js';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 120, 24));
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('观察控件的名称和可用状态，省略隐藏节点、表单内容和链接地址', () => {
  document.body.innerHTML = '<main><h1>Projects</h1><span id="menu">Navigation</span>'
    + '<button aria-labelledby="menu" aria-expanded="true"><svg></svg></button><button hidden>Hidden</button>'
    + '<button disabled>Disabled</button><input value="private email">'
    + '<label>Search projects <input type="search" value="private query"></label>'
    + '<button>Options<span style="display:none"> private drafts</span></button>'
    + '<label>Theme <select><option>private theme</option></select></label>'
    + '<textarea aria-label="Notes">private notes</textarea>'
    + '<a href="https://example.com/projects/recent?q=private">Recent projects</a></main>';

  const observation = createObservation(document);
  const page = observation.page();
  const navigation = page.nodes.find(node => node.label === 'Navigation');

  expect(page.title).toBe('Projects');
  expect(page.site).toBe(document.location.hostname);
  expect(page.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: 'Navigation', role: 'button', expanded: true }),
    expect.objectContaining({ label: 'Disabled', available: false }),
    expect.objectContaining({ label: 'Search projects', role: 'searchbox' }),
    expect.objectContaining({ label: 'Options', role: 'button' }),
    expect.objectContaining({ label: 'Theme', role: 'combobox' }),
    expect.objectContaining({ label: 'Recent projects', role: 'link' }),
  ]));
  expect(JSON.stringify(page)).not.toMatch(/Hidden|private|example\.com/);
  expect(observation.resolve(navigation!.id)?.element).toBe(document.querySelector('button'));
});

it('在指定区域找到首读未返回的控件，保留查询和原有编号', () => {
  document.body.innerHTML = '<main><button>Export</button><aside aria-label="Properties">'
    + '<button>Layout</button>' + '<button>Formatting</button>'.repeat(150)
    + '<button>Export</button></aside></main>';
  const observation = createObservation(document);
  const page = observation.page();
  const properties = page.nodes.find(node => node.label === 'Properties')!;
  const layout = page.nodes.find(node => node.label === 'Layout')!;
  expect(page.truncated).toBe(true);
  expect(page.nodes.filter(node => node.label === 'Export')).toHaveLength(1);

  const query = { type: 'search' as const, query: 'export', region: properties.id };
  const result = observation.read(query);
  expect(result).toMatchObject({ query, status: 'ok', truncated: false });
  expect(result.nodes).toEqual([expect.objectContaining({ label: 'Export', region: properties.id })]);
  expect(result.nodes[0]!.id).not.toBe(page.nodes.find(node => node.label === 'Export')!.id);
  expect(observation.read({ type: 'region', id: properties.id }).nodes).toContainEqual(layout);
  expect(observation.read({ type: 'search', query: 'missing', region: properties.id }).status).toBe('empty');
  expect(observation.read({ type: 'region', id: layout.id }).status).toBe('unavailable');
});

it('搜索拆成连续文本的编号时，只返回同一列表项的链接', () => {
  document.body.innerHTML = '<main><ul><li><span>#10</span><a href="/ten">Ten</a></li>'
    + '<li aria-label="More information"><h3><a href="/one">First review</a></h3>'
    + '<span>#<!--render marker-->1</span><input value="private note">'
    + '<ul><li><span>#2</span><a href="/nested">Nested review</a></li></ul></li>'
    + '</ul></main>';
  const observation = createObservation(document);
  const result = observation.read({ type: 'search', query: '#1' });
  const entry = result.nodes.find(node => node.role === 'listitem')!;
  const links = result.nodes.filter(node => node.role === 'link');
  expect(entry.label).toBe('First review #1');
  expect(links).toEqual([expect.objectContaining({ label: 'First review', object: entry.id })]);
  expect(result.nodes.some(node => node.label === '#1' && node.object === entry.id)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/private note|Nested review|Ten/);

  // 列表虚拟复用同一个条目时，旧链接编号不再代表上一条记录。
  document.querySelector('li[aria-label] > span')!.textContent = '#3';
  expect(observation.resolve(links[0].id)).toBeUndefined();
});

it('按订单号补看表格，返回同一行的入口并排除相邻编号', () => {
  document.body.innerHTML = '<table><tbody><tr><th>ORD-170</th><td><a href="/larger">另一张订单</a></td></tr>'
    + '<tr><th><span>ORD-17</span></th><td><a href="/target">查看订单</a></td></tr></tbody></table>';
  const result = createObservation(document).read({ type: 'search', query: 'ORD-17' });
  const row = result.nodes.find(node => node.role === 'row')!;
  expect(row.label).toBe('ORD-17 查看订单');
  expect(result.nodes.filter(node => node.role === 'link')).toEqual([
    expect.objectContaining({ label: '查看订单', object: row.id }),
  ]);
});

it('检查同一编号时读取复选框当前状态，并保留选中行与页面状态', () => {
  document.body.innerHTML = '<div role="tree"><div role="treeitem" aria-selected="true">Layout</div></div>'
    + '<label>Auto layout <input type="checkbox"></label><div role="status">Ready</div>';
  const observation = createObservation(document);
  const page = observation.page();
  const checkbox = page.nodes.find(node => node.role === 'checkbox')!;
  expect(checkbox).toMatchObject({ label: 'Auto layout', checked: false });
  expect(page.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: 'treeitem', label: 'Layout', selected: true }),
    expect.objectContaining({ role: 'status', label: 'Ready' }),
  ]));

  document.querySelector('input')!.checked = true;
  const query = { type: 'inspect' as const, id: checkbox.id };
  expect(observation.read(query)).toEqual({
    query, nodes: [{ ...checkbox, checked: true }], truncated: false, status: 'ok',
  });
});

it('通过可见标签定位透明的输入控件，并从输入控件复查选中状态', () => {
  document.body.innerHTML = '<aside aria-label="Appearance">'
    + '<input type="checkbox" id="appearance" role="button" aria-label="Appearance" style="opacity:0">'
    + '<label aria-hidden="true" for="appearance"><span>Appearance</span></label>'
    + '<input id="large" type="radio" style="opacity:0"><label for="large"><span>Large</span></label>'
    + '<input id="other" type="radio" style="opacity:0">'
    + '<input id="small" type="radio" style="opacity:0"><label hidden for="small">Small</label>'
    + '<input id="ghost" type="radio" aria-hidden="true" style="opacity:0"><label for="ghost">Ghost</label>'
    + '</aside>';
  const observation = createObservation(document);
  const page = observation.page();
  const option = page.nodes.find(node => node.role === 'radio');
  expect(option).toMatchObject({ role: 'radio', label: 'Large', viewport: true, checked: false });
  expect(page.nodes).toContainEqual(expect.objectContaining({ role: 'button', label: 'Appearance', viewport: true }));
  expect(page.nodes.some(node => node.label === 'Small')).toBe(false);
  expect(page.nodes.some(node => node.label === 'Ghost')).toBe(false);

  const label = document.querySelector<HTMLLabelElement>('label[for="large"]')!;
  const radio = document.querySelector<HTMLInputElement>('#large')!;
  expect(observation.resolve(option!.id)?.element).toBe(label);
  expect(observation.read({ type: 'search', query: 'Large' }).nodes).toEqual([option]);
  radio.checked = true;
  expect(observation.resolve(option!.id)?.evidence.checked).toBe(true);
  radio.disabled = true;
  expect(observation.resolve(option!.id)?.evidence.available).toBe(false);
  label.htmlFor = 'other';
  expect(observation.resolve(option!.id)).toBeUndefined();
});

it('搜索补看可以定位普通标题文字，且不返回可编辑文本', () => {
  document.body.innerHTML = '<aside aria-label="Properties"><div><span>Export presets</span></div>'
    + '<div contenteditable><span>Export draft text</span></div></aside>';
  const observation = createObservation(document);
  const region = observation.page().nodes.find(node => node.label === 'Properties')!;

  const result = observation.read({ type: 'search', query: 'export', region: region.id });
  expect(result.nodes).toEqual([expect.objectContaining({ label: 'Export presets', role: 'text', region: region.id })]);
});

it('行内按钮的名称没变，但复用的行展示新对象后原编号失效', () => {
  document.body.innerHTML = '<div role="grid"><div role="row" aria-labelledby="item-name">'
    + '<span id="item-name">Logo</span><button>Export</button></div></div>';
  const observation = createObservation(document);
  const button = observation.page().nodes.find(node => node.role === 'button')!;

  document.querySelector('#item-name')!.textContent = 'Icon';
  expect(observation.resolve(button.id)).toBeUndefined();
});

it('悬停时出现的行内操作可以单独查找，选中行的名称和编号保持稳定', () => {
  document.body.innerHTML = '<div role="grid"><div role="row" aria-selected="true">'
    + '<span role="gridcell"><a href="/frame">Frame 1</a></span></div></div>';
  const observation = createObservation(document);
  const row = document.querySelector('[role="row"]')!;
  const beforeHover = observation.page().nodes.find(node => node.role === 'row')!;

  row.insertAdjacentHTML('beforeend', '<span role="gridcell">'
    + '<input type="checkbox" id="lock"><label for="lock">Toggle layer locking</label></span>'
    + '<div role="button">Toggle layer visibility</div>');

  expect(observation.page().nodes.find(node => node.role === 'row')).toEqual(beforeHover);
  expect(beforeHover).toMatchObject({ label: 'Frame 1', selected: true });
  expect(observation.read({ type: 'search', query: 'Toggle layer locking' }).nodes).toContainEqual(
    expect.objectContaining({ role: 'checkbox', label: 'Toggle layer locking' }),
  );
  expect(observation.resolve(beforeHover.id)?.element).toBe(row);
});

it('仍可通过标题按钮读取没有独立文本的行名称', () => {
  document.body.innerHTML = '<div role="row"><span role="gridcell"><button>Page 1</button></span></div>';
  const page = createObservation(document).page();
  expect(page.nodes.find(node => node.role === 'row')).toMatchObject({ label: 'Page 1' });
});

it('补看可以读到滚动区裁剪掉的控件，但标明它仍在视口外', () => {
  document.body.innerHTML = '<aside aria-label="Properties" style="overflow: auto">'
    + '<h2>Export presets</h2><button>Export selection</button></aside>';
  const region = document.querySelector('aside')!;
  const button = document.querySelector('button')!;
  Object.defineProperties(region, {
    getBoundingClientRect: { value: () => new DOMRect(0, 0, 200, 100) },
    clientHeight: { value: 100 }, scrollHeight: { value: 300 },
  });
  Object.defineProperty(button, 'getBoundingClientRect', { value: () => new DOMRect(10, 150, 120, 24) });

  const observation = createObservation(document);
  const page = observation.page();
  const properties = page.nodes.find(node => node.label === 'Properties')!;
  expect(properties).toMatchObject({ canScrollUp: false, canScrollDown: true });
  const query = { type: 'region' as const, id: properties.id };
  expect(observation.read(query)).toMatchObject({ truncated: true, nodes: [expect.objectContaining({ label: 'Export presets' })] });
  const result = observation.read({ ...query, includeOffscreen: true });
  expect(result.nodes).toContainEqual(expect.objectContaining({ label: 'Export selection', viewport: false }));
  expect(region.scrollTop).toBe(0);
});

it('检查搜索到的屏外控件时，补回首读未覆盖的区域和相邻标题', () => {
  document.body.innerHTML = '<aside aria-label="Properties"><h2>Export presets</h2><button>Add preset</button></aside>';
  const outside = new DOMRect(10, window.innerHeight + 10, 100, 40);
  for (const element of document.querySelectorAll('aside, h2, button')) {
    Object.defineProperty(element, 'getBoundingClientRect', { value: () => outside });
  }
  const observation = createObservation(document);
  expect(observation.page().nodes).toHaveLength(0);
  const [target] = observation.read({ type: 'search', query: 'Add preset' }).nodes;
  const result = observation.read({ type: 'inspect', id: target!.id });
  expect(result.nodes).toEqual([
    target,
    expect.objectContaining({ label: 'Properties', id: target!.region, viewport: false }),
    expect.objectContaining({ label: 'Export presets', region: target!.region, viewport: false }),
  ]);
});

it.each(['重新命名', '改变角色', '复用原区域', '移动区域', '隐藏节点'])('目标失效后不复用原编号 (%s)', change => {
  document.body.innerHTML = '<aside aria-label="Properties"><button>Export</button></aside>'
    + '<aside aria-label="Layers"></aside>';
  const region = document.querySelector('aside')!;
  const button = document.querySelector('button')!;
  const observation = createObservation(document);
  const id = observation.page().nodes.find(node => node.label === 'Export')!.id;

  if (change === '重新命名') button.textContent = 'Delete';
  if (change === '改变角色') button.setAttribute('role', 'tab');
  if (change === '复用原区域') region.setAttribute('aria-label', 'Account');
  if (change === '移动区域') region.nextElementSibling!.append(button);
  if (change === '隐藏节点') button.hidden = true;

  expect(observation.resolve(id)).toBeUndefined();
  expect(observation.read({ type: 'inspect', id }).status).toBe('unavailable');

  region.setAttribute('aria-label', 'Properties');
  region.append(button);
  button.textContent = 'Export';
  button.removeAttribute('role');
  button.hidden = false;
  const freshId = observation.read({ type: 'search', query: 'Export' }).nodes[0]!.id;
  expect(freshId).toBeGreaterThan(id);
  expect(observation.resolve(id)).toBeUndefined();
  expect(observation.resolve(freshId)?.element).toBe(button);
});

it('观察开放 Shadow DOM 中的控件，使用当地可访问名称和所属区域', () => {
  document.body.innerHTML = '<aside aria-label="Properties"><div></div></aside>';
  const shadow = document.querySelector('div')!.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<span id="name">Add preset</span><button aria-labelledby="name"></button>';
  const observation = createObservation(document);
  const page = observation.page();
  const region = page.nodes.find(node => node.label === 'Properties');
  const target = page.nodes.find(node => node.label === 'Add preset');
  expect(region).toBeDefined();
  expect(target).toMatchObject({ region: region!.id, viewport: true, available: true });
  expect(observation.resolve(target!.id)?.element).toBe(shadow.querySelector('button'));
});
