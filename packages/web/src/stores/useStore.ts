import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, Config } from '../types';

interface AppState {
  user: User | null;
  token: string | null;
  config: Config | null;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setConfig: (config: Config) => void;
  logout: () => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      config: null,
      setUser: (user) => set({ user }),
      setToken: (token) => set({ token }),
      setConfig: (config) => set({ config }),
      logout: () => {
        localStorage.removeItem('token');
        set({ user: null, token: null });
      },
    }),
    {
      name: 'airportal-storage',
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);
