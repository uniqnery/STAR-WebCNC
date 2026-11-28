// Auth Store - Zustand

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { readRoleTest, writeRoleTest, type TestRole } from '../lib/roleTestSession';

export type UserRole = 'USER' | 'ADMIN' | 'HQ_ENGINEER';

export interface User {
  id: string;
  username: string;
  displayName?: string;
  email: string | null;
  mustChangePassword?: boolean;
  role: UserRole;
  isRepresentative?: boolean;
  actualRole?: UserRole;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  rememberMe: boolean;
  testRole: TestRole | null;
  roleTestChanging: boolean;
  setRoleTestChanging: (changing: boolean) => void;
  setTestRole: (role: UserRole) => void;
  restoreTestRole: (user?: User) => void;

  // Actions
  setAuth: (user: User, accessToken: string, rememberMe?: boolean) => void;
  setAccessToken: (token: string) => void;
  logout: () => void;
}

// Persistent sessions survive reopening; unchecked sessions stay in this tab only.
const authStorage: StateStorage = {
  getItem: name => {
    try { return sessionStorage.getItem(name) ?? localStorage.getItem(name); } catch { return null; }
  },
  setItem: (name, value) => {
    try {
      const remember = JSON.parse(value).state.rememberMe !== false;
      (remember ? localStorage : sessionStorage).setItem(name, value);
      (remember ? sessionStorage : localStorage).removeItem(name);
    } catch { /* Private browsing can disable storage; keep the in-memory session. */ }
  },
  removeItem: name => { try { localStorage.removeItem(name); sessionStorage.removeItem(name); } catch {} },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      rememberMe: true, // Preserve previously issued sessions until the next explicit login.
      testRole: null,
      roleTestChanging: false,
      setRoleTestChanging: (roleTestChanging) => set({ roleTestChanging }),
      setTestRole: (role) => {
        const user = get().user;
        if (!user || (user.actualRole ?? user.role) !== 'HQ_ENGINEER') throw new Error('본사 엔지니어만 사용할 수 있습니다.');
        const testRole = role === 'HQ_ENGINEER' ? null : role;
        writeRoleTest(user.id, testRole);
        set({ testRole, user: { ...user, actualRole: 'HQ_ENGINEER', role } });
      },
      restoreTestRole: (supplied) => {
        const user = supplied ?? get()?.user;
        if (!user) return;
        const actualRole = user.actualRole ?? user.role;
        const testRole = actualRole === 'HQ_ENGINEER' ? readRoleTest(user.id) : null;
        set({ testRole, user: { ...user, actualRole, role: testRole ?? actualRole } });
      },

      setAuth: (user, accessToken, rememberMe = get().rememberMe) => {
        const actualRole = user.actualRole ?? user.role;
        const testRole = actualRole === 'HQ_ENGINEER' ? readRoleTest(user.id) : null;
        set({
          user: { ...user, actualRole, role: testRole ?? actualRole },
          testRole,
          accessToken,
          isAuthenticated: true,
          rememberMe,
        });
      },

      setAccessToken: (accessToken) =>
        set({ accessToken }),

      logout: () => {
        try { writeRoleTest('', null); } catch {}
        set({
          testRole: null,
          user: null,
          accessToken: null,
          isAuthenticated: false,
          rememberMe: false,
        });
      },

    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => authStorage),
      partialize: (state) => ({
        user: state.user ? { ...state.user, role: state.user.actualRole ?? state.user.role } : null,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated,
        rememberMe: state.rememberMe,
      }),
      onRehydrateStorage: () => state => {
        if (state?.accessToken === 'dev-token') state.logout();
        else state?.restoreTestRole(state.user ?? undefined);
      },
    }
  )
);
