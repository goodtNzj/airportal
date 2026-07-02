import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => (set: any, get: any, api: any) => {
    api.persist = { clearStorage: vi.fn(), rehydrate: vi.fn() };
    return fn(set, get, api);
  },
}));

const { useStore } = await import('../../src/stores/useStore');

describe('useStore', () => {
  beforeEach(() => {
    act(() => {
      useStore.setState({
        user: null,
        config: null,
      });
    });
  });

  it('should have initial state', () => {
    const state = useStore.getState();
    expect(state.user).toBeNull();
    expect(state.config).toBeNull();
  });

  it('should set user', () => {
    act(() => {
      useStore.getState().setUser({ userId: 1, username: 'test' });
    });

    expect(useStore.getState().user).toEqual({
      userId: 1,
      username: 'test',
    });
  });

  it('should set config', () => {
    const config = {
      maxFileSize: 52428800,
      maxFolderUncompressedSize: 524288000,
      maxFolderCompressedSize: 314572800,
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
    act(() => {
      useStore.getState().setUser({ userId: 1, username: 'test' });
    });

    expect(useStore.getState().user).not.toBeNull();

    act(() => {
      useStore.getState().logout();
    });

    expect(useStore.getState().user).toBeNull();
  });

  it('should clear user on setUser(null)', () => {
    act(() => {
      useStore.getState().setUser({ userId: 1, username: 'test' });
    });

    expect(useStore.getState().user).not.toBeNull();

    act(() => {
      useStore.getState().setUser(null);
    });

    expect(useStore.getState().user).toBeNull();
  });
});
