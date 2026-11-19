// 页面只有一份授权。后台正常时每两秒续期；失联后最后一次授权最多有效六秒。
export const MAX_LEASE_MS = 6_000;

export function createLease(onExpire: () => void) {
  let expiresAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clear() {
    clearTimeout(timer);
    timer = undefined;
    expiresAt = 0;
  }

  function expire() {
    clear();
    onExpire();
  }

  function live() {
    if (!expiresAt) return false;
    // 后台标签页可能被浏览器冻结。即使计时器尚未得到执行，也不能沿用已过期的授权。
    if (Date.now() >= expiresAt) {
      expire();
      return false;
    }
    return true;
  }

  function grant(requestedMs: number) {
    clear();
    if (!Number.isFinite(requestedMs) || requestedMs <= 0) {
      onExpire();
      return;
    }
    const duration = Math.min(requestedMs, MAX_LEASE_MS);
    expiresAt = Date.now() + duration;
    timer = setTimeout(expire, duration);
  }

  return { grant, live, clear };
}
