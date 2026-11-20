import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { startIssueNavigation } from '../navigation/browser-session.js';
import type { NavigationStatus } from '../navigation/browser-session.js';
import { validIssueNumber } from '../navigation/issue-goal.js';

export function App() {
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

  const canStart = validIssueNumber(issue.trim()) && !!token.trim();
  return <main className="panel">
    <h1>实时网页引导</h1>
    <p>在当前 GitHub 仓库中查找指定 Issue。页面标题和控件文字会发给已配置的模型。</p>
    <form onSubmit={event => {
      event.preventDefault();
      if (!canStart) return;
      stop.current?.();
      setStatus({ text: '正在连接当前网页…' });
      const accessToken = token.trim();
      void browser.storage.session.set({ navigationToken: accessToken }).catch(() => {});
      stop.current = startIssueNavigation(issue.trim(), accessToken, setStatus);
    }}>
      <label>Issue 编号<input value={issue} onChange={event => setIssue(event.target.value)} inputMode="numeric" placeholder="例如 17" /></label>
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
