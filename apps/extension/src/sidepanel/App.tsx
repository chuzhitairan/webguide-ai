import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { startNavigation } from '../navigation/browser-session.js';
import type { NavigationStatus } from '../navigation/browser-session.js';
import { validIssueNumber } from '../navigation/github-goal.js';
import type { Goal } from '../navigation/protocol.js';

export function App() {
  const [task, setTask] = useState<Goal['kind']>('issue');
  const [issue, setIssue] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<NavigationStatus>();
  const stop = useRef<() => void>(undefined);

  useEffect(() => {
    let mounted = true;
    void browser.storage.session.get('navigationToken').then(({ navigationToken }) => {
      if (mounted && typeof navigationToken === 'string') setToken(current => current || navigationToken);
    }).catch(() => {});
    return () => {
      mounted = false;
      stop.current?.();
    };
  }, []);

  const canStart = (task !== 'issue' || validIssueNumber(issue.trim())) && !!token.trim();
  return <main className="panel">
    <h1>实时网页引导</h1>
    <p>在 GitHub 查找 Issue 或 README 编辑入口，也可以在 Figma 练习稿中找到自动布局。扩展会把引导需要的页面信息发给已配置的模型。</p>
    <form onSubmit={event => {
      event.preventDefault();
      if (!canStart) return;
      stop.current?.();
      setStatus({ text: '正在连接当前网页…' });
      const accessToken = token.trim();
      void browser.storage.session.set({ navigationToken: accessToken }).catch(() => {});
      const goal: Goal = task === 'issue' ? { kind: task, number: issue.trim() } : { kind: task };
      stop.current = startNavigation(goal, accessToken, setStatus);
    }}>
      <label>引导目标<select value={task} onChange={event => setTask(event.target.value as Goal['kind'])}>
        <option value="issue">打开指定 Issue</option>
        <option value="readme-entry">找到 README 编辑入口</option>
        <option value="readme-editor">进入 README 编辑器</option>
        <option value="figma-auto-layout">Figma · 找到 Frame 1 的自动布局</option>
      </select></label>
      {task === 'issue' && <label>Issue 编号<input value={issue} onChange={event => setIssue(event.target.value)} inputMode="numeric" placeholder="例如 17" /></label>}
      <label>本机访问令牌<input type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" /></label>
      <div className="actions">
        <button type="submit" disabled={!canStart}>开始引导</button>
        {status && !status.done && <button type="button" onClick={() => {
          stop.current?.();
          stop.current = undefined;
          setStatus(undefined);
        }}>停止</button>}
      </div>
    </form>
    {status && <p className="status" role="status">{status.text}</p>}
    <details>
      <summary>本机服务设置</summary>
      <p>令牌取自后端的 WG_CLIENT_TOKEN。扩展来源填写下面这一项。</p>
      <code>{globalThis.location.origin}</code>
    </details>
  </main>;
}
