import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLease } from '../lease.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('caps an initial grant at six seconds even if the sender asks for longer', () => {
  const expired = vi.fn();
  const lease = createLease(expired);
  lease.grant(90_000);
  vi.advanceTimersByTime(5_999);
  expect(lease.live()).toBe(true);
  vi.advanceTimersByTime(1);
  expect(lease.live()).toBe(false);
  expect(expired).toHaveBeenCalledTimes(1);
});

it('checks wall time on wake and never revives an expired lease by renewing it', () => {
  const expired = vi.fn();
  const lease = createLease(expired);
  lease.grant(6_000);
  vi.setSystemTime(Date.now() + 6_001);
  expect(lease.live()).toBe(false);
  expect(expired).toHaveBeenCalledTimes(1);
  lease.clear();
  vi.runAllTimers();
  expect(expired).toHaveBeenCalledTimes(1);
});
