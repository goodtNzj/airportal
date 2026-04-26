import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

// 模拟 zustand 的 persist 中间件
vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
}));

// 在模拟后导入
const { useStore } = await import('../../src/stores/useStore');

describe('useStore', () => {
  beforeEach(() => {
    // 重置 store
    act(() => {
      useStore.setState({
        user: null,
        token: null,
        config: null,
      });
    });
  });

  it('should have initial state', () => {
    const state = useStore.getState();
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(state.config).toBeNull();
  });

  it('should set user', () => {
    act(() => {
      useStore.getState().setUser({ id: 1, username: 'test', createdAt: '2024-01-01' });
    });

    expect(useStore.getState().user).toEqual({
      id: 1,
      username: 'test',
      createdAt: '2024-01-01',
    });
  });

  it('should set token', () => {
    act(() => {
      useStore.getState().setToken('test-token');
    });

    expect(useStore.getState().token).toBe('test-token');
  });

  it('should set config', () => {
    const config = {
      maxFileSize: 52428800,
      maxTextLength: 10000,
      defaultExpiry: 180,
      maxExpiry: 3600,
    };

    act(() => {
      useStore.getState().setConfig(config);
    });

    expect(useStore.getState().config).toEqual(config);
  });

  it('should logout', () => {
    // 先设置用户和 token
    act(() => {
      useStore.getState().setUser({ id: 1, username: 'test', createdAt: '2024-01-01' });
      useStore.getState().setToken('test-token');
    });

    expect(useStore.getState().user).not.toBeNull();
    expect(useStore.getState().token).not.toBeNull();

    // 登出
    act(() => {
      useStore.getState().logout();
    });

    expect(useStore.getState().user).toBeNull();
    expect(useStore.getState().token).toBeNull();
  });

  it('should clear user on setUser(null)', () => {
    act(() => {
      useStore.getState().setUser({ id: 1, username: 'test', createdAt: '2024-01-01' });
    });

    expect(useStore.getState().user).not.toBeNull();

    act(() => {
      useStore.getState().setUser(null);
    });

    expect(useStore.getState().user).toBeNull();
  });
});
