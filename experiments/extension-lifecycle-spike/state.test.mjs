import test from 'node:test';
import assert from 'node:assert/strict';
import {pageRole, recover, ownsTask, matchesObservation} from './state.mjs';
const url = 'http://127.0.0.1:43117/webguide-lifecycle/settings.html';
const task = {id: 'task-a', revision: 4, status: 'active', owner: 'panel-new', windowId: 7};
const expected = {taskId: task.id, revision: 4, requestId: 'r1', documentId: 'd1', role: 'settings', url};
const msg = {...expected};
test('仅接受精确实验地址；拒绝其他端口、查询参数、伪装主机和交换页面角色', () => {
  assert.equal(pageRole(url), 'settings');
  for (const raw of [url + '?x=1', url + '#a', url.replace('43117', '43119'),
    url.replace('127.0.0.1', '127.0.0.1.evil.test'), url.replace('settings', 'site')]) {
    assert.equal(pageRole(raw), null);
  }
  assert.equal(pageRole('http://127.0.0.1:43118/webguide-lifecycle/site.html'), 'site');
});
test('后台恢复时活动任务暂停，原始检查点不被原地修改', () => {
  const saved = {schema: 1, task, logs: []};
  const result = recover(saved, 'boot-new');
  assert.equal(result.task.status, 'paused');
  assert.equal(result.task.revision, 5);
  assert.equal(result.task.owner, null);
  assert.equal(saved.task.status, 'active');
});
test('已暂停状态在后台恢复时保持暂停', () => {
  const result = recover({schema: 1, task: {...task, status: 'paused'}, logs: []}, 'boot-new');
  assert.equal(result.task.status, 'paused');
  assert.equal(result.task.revision, 4);
});
test('丢失检查点不制造一个活动任务', () => assert.equal(recover(null, 'boot').task, null));
test('旧面板和其他窗口不能拥有当前任务', () => {
  assert.equal(ownsTask(task, 'panel-new', 7), true);
  assert.equal(ownsTask(task, 'panel-old', 7), false);
  assert.equal(ownsTask(task, 'panel-new', 8), false);
});
test('有效观察必须同时匹配任务、修订、请求、文档及页面', () => {
  assert.equal(matchesObservation(task, expected, msg, 'd1'), true);
  for (const patch of [{taskId: 'other'}, {revision: 3}, {requestId: 'old'},
    {url: url.replace('settings', 'workflow')}]) {
    assert.equal(matchesObservation(task, expected, {...msg, ...patch}, 'd1'), false);
  }
  assert.equal(matchesObservation(task, expected, msg, 'old-document'), false);
});
test('暂停后的迟到成功不能被接纳', () => {
  assert.equal(matchesObservation({...task, status: 'paused'}, expected, msg, 'd1'), false);
});
