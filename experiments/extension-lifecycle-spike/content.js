(() => {
  const allowed = new Set([
    'http://127.0.0.1:43117/webguide-lifecycle/settings.html',
    'http://127.0.0.1:43117/webguide-lifecycle/workflow.html',
    'http://127.0.0.1:43118/webguide-lifecycle/site.html',
  ]);
  if (!allowed.has(location.href)) return;
  let port, target, box, revisionUrl, expiry, reconnect, requestContext;
  let observer;
  const ownedOverlays = new WeakSet();
  function send(msg) { try { port?.postMessage(msg); } catch { clear('connection-error'); } }
  function clear(reason, report = false) {
    const hadTarget = Boolean(target);
    const previousRequest = requestContext;
    requestContext = null;
    observer?.disconnect();
    target = null;
    box?.remove();
    box = null;
    clearTimeout(expiry);
    if (hadTarget && report) send({...previousRequest, type: 'invalidated', reason});
  }
  function position() {
    if (!target) return;
    if (location.href !== revisionUrl || !target.isConnected || !allowed.has(location.href)) {
      clear('url-or-target-changed', true);
      return;
    }
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || getComputedStyle(target).visibility === 'hidden') {
      clear('target-not-visible', true);
      return;
    }
    Object.assign(box.style, {left: `${rect.left - 5}px`, top: `${rect.top - 5}px`,
      width: `${rect.width + 10}px`, height: `${rect.height + 10}px`});
  }
  function connect() {
    if (!allowed.has(location.href)) return;
    try {
      port = chrome.runtime.connect({name: 'wg-lifecycle-page'});
      port.onMessage.addListener((msg) => {
        if (msg.type === 'clear') return clear(msg.reason);
        if (msg.type !== 'check') return;
        clear('new-check');
        if (!allowed.has(location.href) || msg.url !== location.href) return;
        requestContext = msg;
        const candidates = document.querySelectorAll('#wg-lifecycle-target');
        const found = candidates.length === 1 && candidates[0].getBoundingClientRect().width > 0;
        if (found) {
          target = candidates[0];
          revisionUrl = location.href;
          box = document.createElement('div');
          ownedOverlays.add(box);
          box.id = 'wg-lifecycle-overlay';
          box.setAttribute('aria-hidden', 'true');
          Object.assign(box.style, {position: 'fixed', pointerEvents: 'none',
            border: '3px solid #2563eb', borderRadius: '8px', zIndex: '2147483647',
            boxSizing: 'border-box'});
          document.documentElement.append(box);
          position();
          observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, characterData: true});
          // Finite safety lease; no heartbeat that would conceal SW idle termination.
          expiry = setTimeout(() => clear('10-second-test-lease-expired', true), 10_000);
        }
        send({type: 'observation', taskId: msg.taskId, revision: msg.revision,
          requestId: msg.requestId, url: location.href,
          target: target ? 'unique-visible' : 'missing-or-ambiguous'});
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        clear('page-port-disconnected');
        clearTimeout(reconnect);
        reconnect = setTimeout(connect, 1000);
      });
      send({type: 'hello'});
    } catch { clear('extension-unavailable'); }
  }
  observer = new MutationObserver((records) => {
    const onlyOwnOverlay = (r) => ownedOverlays.has(r.target) ||
      (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every((node) => ownedOverlays.has(node)));
    if (!target || records.every(onlyOwnOverlay)) return;
    clear('dom-changed-recheck-required', true);
  });
  addEventListener('scroll', position, true);
  addEventListener('resize', position);
  addEventListener('popstate', () => clear('history-navigation', true));
  addEventListener('pagehide', () => clear('page-hidden-or-unloaded', true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear('document-hidden', true);
  });
  setInterval(() => {
    if (target && location.href !== revisionUrl) clear('url-changed', true);
  }, 200);
  connect();
})();
