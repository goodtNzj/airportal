import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserPayload, Config } from '../types';

interface AppState {
  user: UserPayload | null;
  config: Config | null;
  setUser: (user: UserPayload | null) => void;
  setConfig: (config: Config) => void;
  logout: () => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, _get, api) => ({
      user: null,
      config: null,
      setUser: (user) => set({ user }),
      setConfig: (config) => set({ config }),
      logout: () => {
        set({ user: null });
        api.persist.clearStorage();
      },
    }),
    {
      name: 'airportal-storage',
      partialize: (state) => ({ user: state.user }),
    }
  )
);
