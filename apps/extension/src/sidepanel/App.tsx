import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { browser } from 'wxt/browser';
import { configureModel } from '../../../api/src/guide.js';
import type { ModelConfig } from '../../../api/src/guide.js';
import { bindGuide, bindingKey, readActiveBinding } from '../guide/browser-link.js';
import type { Binding } from '../guide/browser-link.js';
import { chooseGuide } from '../guide/model-client.js';
import { createGuideSession, guideRequestLimit } from '../guide/session.js';
import type { GuideProgress, GuideStatus } from '../guide/session.js';

type Checkpoint = { goal: string; used: number; progress?: GuideProgress };
const checkpointKey = (windowId: number) => 'guide-draft:' + windowId;
const modelSessionKey = 'webguide-model-session';
const modelSettingsKey = 'webguide-model-settings';
const defaultSettings = { address: 'https://agi.tongji.edu.cn/v1', name: 'DeepSeek-V4.1-Flash', useExperience: false };
type ModelSettings = typeof defaultSettings;
type ModelSession = { settings: ModelSettings; key: string };
const initialStatus = { kind: 'waiting', text: '在要引导的网页点击 WebGuide AI 工具栏图标，然后输入目标。' } as const;

export function App() {
  const [goal, setGoal] = useState('');
  const [settings, setSettings] = useState(defaultSettings);
  const [modelKey, setModelKey] = useState('');
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
      const [values, preferences] = await Promise.all([
        browser.storage.session.get([key, modelSessionKey]), browser.storage.local.get(modelSettingsKey),
      ]);
      if (!active || action.current !== 0) return;
      const previous = values[key] as Checkpoint | undefined;
      const modelSession = values[modelSessionKey] as ModelSession | undefined;
      const savedSettings = modelSession?.settings ?? preferences[modelSettingsKey] as ModelSettings | undefined;
      if (savedSettings) setSettings(savedSettings);
      if (modelSession) setModelKey(modelSession.key);
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
      if (value) await browser.storage.session.set({ [key]: value });
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
    const requested = (resuming ? draft.current?.goal : goal)?.trim();
    if (!requested) return;
    let model: ModelConfig;
    try {
      model = configureModel(settings.address, settings.name, modelKey);
    } catch (error) {
      setStatus({ kind: 'waiting', text: error instanceof Error ? error.message : '请检查模型设置。' });
      return;
    }
    const task = action.current + 1;
    action.current = task;
    unbindCurrent();
    setAnswer('');
    const used = resuming && draft.current && draft.current.used < guideRequestLimit ? draft.current.used : 0;
    const progress = resuming ? draft.current?.progress : undefined;
    draft.current = { goal: requested, used, progress };
    setCanContinue(true);
    setStatus({ kind: 'reading', text: '正在连接当前标签页…' });

    try {
      // 权限请求由「开始／继续」的点击直接触发，且只申请配置的模型域名。
      const { protocol, hostname } = new URL(model.url);
      const allowed = await browser.permissions.request({ origins: [`${protocol}//${hostname}/*`] });
      if (action.current !== task) return;
      if (!allowed) {
        setStatus({ kind: 'paused', text: '请允许扩展访问模型服务的域名，再继续引导。' });
        return;
      }
      const current = await browser.windows.getCurrent();
      if (action.current !== task || current.id === undefined) return;
      windowId.current = current.id;
      // 密钥只随浏览器会话保存，重开侧栏可以沿用。普通配置可跨浏览器重启保留。
      await Promise.all([
        browser.storage.local.set({ [modelSettingsKey]: settings }),
        browser.storage.session.set({ [modelSessionKey]: { settings, key: model.key } satisfies ModelSession }),
      ]);
      if (action.current !== task) return;
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
        choose: (input, signal) => chooseGuide(input, model, signal, settings.useExperience),
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

  function changeModelAddress(address: string) {
    // 切换服务时重新填写对应的密钥，避免把上一个服务的密钥带过去。
    if (URL.parse(address)?.origin !== URL.parse(settings.address)?.origin) setModelKey('');
    setSettings({ ...settings, address });
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
      <label>模型 API 密钥
        <input type="password" value={modelKey} onChange={event => setModelKey(event.target.value)} autoComplete="off" />
      </label>
      <details>
        <summary>模型设置</summary>
        <label>模型 API 地址
          <input value={settings.address} onChange={event => changeModelAddress(event.target.value)} />
        </label>
        <label>模型名称
          <input value={settings.name} onChange={event => setSettings({ ...settings, name: event.target.value })} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={settings.useExperience}
            onChange={event => setSettings({ ...settings, useExperience: event.target.checked })} />
          启用导航经验（试验）
        </label>
      </details>
      <div className="actions">
        <button type="submit" disabled={!goal.trim() || !modelKey.trim()}>开始引导</button>
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
  </main>;
}
