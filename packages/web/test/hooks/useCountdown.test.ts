import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountdown } from '../../src/hooks/useCountdown';

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return correct initial values', () => {
    const expiresAt = new Date(Date.now() + 180000); // 3 分钟后
    const { result } = renderHook(() => useCountdown(expiresAt));

    expect(result.current.timeLeft).toBe(180);
    expect(result.current.minutes).toBe(3);
    expect(result.current.seconds).toBe(0);
    expect(result.current.isExpired).toBe(false);
  });

  it('should format time correctly', () => {
    const expiresAt = new Date(Date.now() + 125000); // 2分5秒
    const { result } = renderHook(() => useCountdown(expiresAt));

    expect(result.current.formatted).toBe('02:05');
  });

  it('should count down over time', () => {
    const expiresAt = new Date(Date.now() + 3000); // 3 秒后
    const { result } = renderHook(() => useCountdown(expiresAt));

    expect(result.current.timeLeft).toBe(3);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.timeLeft).toBe(2);
    expect(result.current.formatted).toBe('00:02');
  });

  it('should mark as expired when time runs out', () => {
    const expiresAt = new Date(Date.now() + 1000);
    const { result } = renderHook(() => useCountdown(expiresAt));

    expect(result.current.isExpired).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.timeLeft).toBe(0);
    expect(result.current.isExpired).toBe(true);
    expect(result.current.formatted).toBe('00:00');
  });

  it('should handle already expired time', () => {
    const expiresAt = new Date(Date.now() - 1000); // 已过期
    const { result } = renderHook(() => useCountdown(expiresAt));

    expect(result.current.timeLeft).toBe(0);
    expect(result.current.isExpired).toBe(true);
  });
});
