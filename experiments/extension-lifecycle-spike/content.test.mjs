import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('./content.js', import.meta.url), 'utf8');
function harness() {
  let observer;
  const messages = [], received = [], disconnected = [], children = [];
  const target = {isConnected: true, getBoundingClientRect: () => ({left: 10, top: 20, width: 100, height: 40})};
  const root = {append(node) { children.push(node); }};
  const document = {documentElement: root, querySelectorAll: () => [target], addEventListener() {},
    createElement() { return {style: {}, setAttribute() {}, remove() { this.removed = true; }}; }};
  const port = {postMessage: (msg) => messages.push(msg),
    onMessage: {addListener: (fn) => received.push(fn)},
    onDisconnect: {addListener: (fn) => disconnected.push(fn)}};
  const context = vm.createContext({document, location: {href: 'http://127.0.0.1:43117/webguide-lifecycle/settings.html'},
    chrome: {runtime: {connect: () => port}},
    MutationObserver: class {constructor(fn) { observer = fn; } observe() {} disconnect() {}},
    addEventListener() {}, getComputedStyle: () => ({visibility: 'visible'}),
    setTimeout: () => 1, clearTimeout() {}, setInterval() {}});
  vm.runInContext(source, context);
  const request = {type: 'check', taskId: 'task-a', revision: 2, requestId: 'req-a',
    url: context.location.href, documentId: 'doc-a'};
  received[0](request);
  return {observer, root, target, box: children[0], messages, request, disconnected, context};
}
test('添加或定位实验自己的蓝框不会被误认为宿主页面改变', () => {
  const h = harness();
  h.observer([{type: 'childList', target: h.root, addedNodes: [h.box], removedNodes: []}]);
  assert.notEqual(h.box.removed, true);
  h.observer([{type: 'attributes', target: h.box}]);
  assert.notEqual(h.box.removed, true);
});
test('目标移除立即撤销蓝框，失效通知带原请求身份', () => {
  const h = harness();
  h.target.isConnected = false;
  h.observer([{type: 'childList', target: h.root, addedNodes: [], removedNodes: [h.target]}]);
  assert.equal(h.box.removed, true);
  const msg = h.messages.find((m) => m.type === 'invalidated');
  assert.equal(msg.taskId, h.request.taskId);
  assert.equal(msg.requestId, h.request.requestId);
  assert.equal(msg.revision, h.request.revision);
});
test('页面连接断开立即撤销蓝框', () => {
  const h = harness();
  h.disconnected[0]();
  assert.equal(h.box.removed, true);
});
