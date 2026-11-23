import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { browser } from 'wxt/browser';
import { bindGuide, bindingKey, readActiveBinding } from '../guide/browser-link.js';
import type { Binding } from '../guide/browser-link.js';
import { chooseGuide } from '../guide/model-client.js';
import { createGuideSession, guideRequestLimit } from '../guide/session.js';
import type { GuideProgress, GuideStatus } from '../guide/session.js';

type Checkpoint = { goal: string; used: number; progress?: GuideProgress };
const checkpointKey = (windowId: number) => 'guide-draft:' + windowId;
const tokenKey = 'webguide-service-token';
const initialStatus = { kind: 'waiting', text: '在要引导的网页点击 WebGuide AI 工具栏图标，然后输入目标。' } as const;

export function App() {
  const [goal, setGoal] = useState('');
  const [token, setToken] = useState('');
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<GuideStatus>(initialStatus);
  const [canContinue, setCanContinue] = useState(false);
  const windowId = useRef<number | undefined>(undefined);
  const draft = useRef<Checkpoint | undefined>(undefined);
  const session = useRef<ReturnType<typeof createGuideSession> | undefined>(undefined);
  const unbind = useRef<(() => void) | undefined>(undefined);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const action = useRef(0);
  const pendingWrite = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    void browser.windows.getCurrent().then(async current => {
      if (!active || current.id === undefined) return;
      windowId.current = current.id;
      const key = checkpointKey(current.id);
      const values = await browser.storage.session.get([key, tokenKey]);
      if (!active || action.current !== 0) return;
      const previous = values[key] as Checkpoint | undefined;
      if (typeof values[tokenKey] === 'string') setToken(values[tokenKey]);
      if (previous?.goal) {
        draft.current = previous;
        setGoal(previous.goal);
        setCanContinue(true);
        setStatus({ kind: 'paused', text: '上次的目标可以继续。' });
      }
    }).catch(() => {});
    return () => {
      active = false;
      unbind.current?.();
      clearTimeout(finishTimer.current);
    };
  }, []);

  // 顺序写入已经发出的请求次数，避免停止时旧任务的记录覆盖新任务。
  function save(value?: Checkpoint) {
    const id = windowId.current;
    if (id === undefined) return Promise.resolve();
    const key = checkpointKey(id);
    pendingWrite.current = pendingWrite.current.catch(() => {}).then(async () => {
      if (value) await browser.storage.session.set({ [key]: value, [tokenKey]: token.trim() });
      else await browser.storage.session.remove(key);
    });
    return pendingWrite.current;
  }

  function unbindCurrent() {
    clearTimeout(finishTimer.current);
    unbind.current?.();
    unbind.current = undefined;
    session.current = undefined;
  }

  async function start(resuming: boolean) {
    const task = action.current + 1;
    action.current = task;
    unbindCurrent();
    setAnswer('');
    const requested = (resuming ? draft.current?.goal : goal)?.trim();
    const clientToken = token.trim();
    if (!requested || !clientToken) return;
    const used = resuming && draft.current && draft.current.used < guideRequestLimit ? draft.current.used : 0;
    const progress = resuming ? draft.current?.progress : undefined;
    draft.current = { goal: requested, used, progress };
    setCanContinue(true);
    setStatus({ kind: 'reading', text: '正在连接当前标签页…' });

    try {
      const current = await browser.windows.getCurrent();
      if (action.current !== task || current.id === undefined) return;
      windowId.current = current.id;
      await save(draft.current);
      const key = bindingKey(current.id);
      const stored = await browser.storage.session.get(key);
      const binding = (stored[key] as Binding | undefined) ?? await readActiveBinding(current.id);
      if (action.current !== task) return;
      if (!binding) {
        setStatus({ kind: 'paused', text: '先在目标网页点击 WebGuide AI 工具栏图标，再选择继续引导。' });
        return;
      }
      let finished = false;
      const report = (next: GuideStatus) => {
        if (action.current !== task || finished) return;
        setStatus(next);
        if (next.kind === 'complete') {
          finished = true;
          draft.current = undefined;
          setCanContinue(false);
          void save().catch(() => {});
          finishTimer.current = setTimeout(unbindCurrent, 4_200);
        }
      };
      const guiding = createGuideSession(requested, {
        used, progress, report,
        choose: (input, signal) => chooseGuide(input, clientToken, signal),
        saveUsed(count) {
          if (action.current !== task) return Promise.resolve();
          draft.current = { ...draft.current, goal: requested, used: count };
          return save(draft.current);
        },
        saveProgress(next) {
          if (action.current !== task || !draft.current) return;
          draft.current = { ...draft.current, progress: next };
          void save(draft.current).catch(() => {});
        },
      });
      session.current = guiding;
      unbind.current = bindGuide(binding, current.id, guiding, report);
    } catch {
      if (action.current === task) setStatus({ kind: 'paused', text: '暂时无法启动引导，请重试。' });
    }
  }

  function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void start(false);
  }

  function stop() {
    action.current++;
    unbindCurrent();
    draft.current = undefined;
    setCanContinue(false);
    setStatus({ kind: 'waiting', text: '已停止引导。' });
    void save().catch(() => {});
  }

  function reply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!answer.trim()) return;
    void session.current?.reply(answer.trim());
    setAnswer('');
  }

  return <main className="panel">
    <h1>WebGuide AI</h1>
    <p>输入你想完成的网页操作。扩展把目标和必要的页面线索发给已配置的模型。</p>
    <form onSubmit={begin}>
      <label>我想做什么
        <textarea value={goal} onChange={event => setGoal(event.target.value)} rows={3} maxLength={500}
          placeholder="例如：带我找到这个页面的导出设置" />
      </label>
      <label>本机访问令牌
        <input type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" />
      </label>
      <div className="actions">
        <button type="submit" disabled={!goal.trim() || !token.trim()}>开始引导</button>
        {canContinue && <button type="button" onClick={stop}>停止</button>}
        {canContinue && status.kind === 'paused' && <button type="button" onClick={() => void start(true)}>继续引导</button>}
      </div>
    </form>
    <p role="status">{status.text}</p>
    {status.kind === 'asking' && <form onSubmit={reply}>
      <label>补充说明<input value={answer} onChange={event => setAnswer(event.target.value)} maxLength={500} /></label>
      <button type="submit" disabled={!answer.trim()}>回答并继续</button>
    </form>}
    {status.kind === 'confirm' && <div className="actions">
      <p>{status.result}</p>
      <button type="button" onClick={() => void session.current?.confirm(status.index)}>
        {status.source === 'point' ? '查看下一个入口' : '确认这项已完成'}
      </button>
    </div>}
    <details>
      <summary>本机服务设置</summary>
      <p>扩展来源 <code>{globalThis.location.origin}</code></p>
    </details>
  </main>;
}
