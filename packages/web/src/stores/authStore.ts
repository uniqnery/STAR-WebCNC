// Auth Store - Zustand

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { readRoleTest, writeRoleTest, type TestRole } from '../lib/roleTestSession';

const MOCK_USER = {
  id: 'dev-user-001',
  username: 'admin',
  email: 'admin@star-webcnc.local',
  role: 'HQ_ENGINEER' as const,
};

export type UserRole = 'USER' | 'ADMIN' | 'HQ_ENGINEER';

export interface User {
  id: string;
  username: string;
  displayName?: string;
  email: string;
  role: UserRole;
  actualRole?: UserRole;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  testRole: TestRole | null;
  roleTestChanging: boolean;
  setRoleTestChanging: (changing: boolean) => void;
  setTestRole: (role: UserRole) => void;
  restoreTestRole: (user?: User) => void;

  // Actions
  setAuth: (user: User, accessToken: string) => void;
  setAccessToken: (token: string) => void;
  logout: () => void;
  devLogin: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
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

      setAuth: (user, accessToken) => {
        const actualRole = user.actualRole ?? user.role;
        const testRole = actualRole === 'HQ_ENGINEER' ? readRoleTest(user.id) : null;
        set({
          user: { ...user, actualRole, role: testRole ?? actualRole },
          testRole,
          accessToken,
          isAuthenticated: true,
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
        });
      },

      devLogin: () => {
        set({
          testRole: null,
          user: MOCK_USER,
          accessToken: 'dev-token',
          isAuthenticated: true,
        });
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user ? { ...state.user, role: state.user.actualRole ?? state.user.role } : null,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => state => state?.restoreTestRole(state.user ?? undefined),
    }
  )
);
