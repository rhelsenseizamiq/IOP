import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { setAccessToken } from '../api/client';
import { authApi } from '../api/auth';
import type { Role } from '../types/auth';

interface AuthContextValue {
  isAuthenticated: boolean;
  isInitializing: boolean;
  username: string | null;
  fullName: string | null;
  role: Role | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (required: Role) => boolean;
}

const ROLE_LEVELS: Record<Role, number> = {
  Viewer: 1,
  Operator: 2,
  Administrator: 3,
  SuperAdmin: 4,
};

const defaultContextValue: AuthContextValue = {
  isAuthenticated: false,
  isInitializing: true,
  username: null,
  fullName: null,
  role: null,
  login: async () => {},
  logout: async () => {},
  hasRole: () => false,
};

export const AuthContext = createContext<AuthContextValue>(defaultContextValue);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    authApi
      .refresh()
      .then((res) => {
        setAccessToken(res.data.access_token);
        setIsAuthenticated(true);
        setRole(res.data.role);
        setFullName(res.data.full_name);
        return authApi.me();
      })
      .then((res) => {
        setUsername(res.data.username);
      })
      .catch(() => {})
      .finally(() => {
        setIsInitializing(false);
      });
  }, []);

  const login = useCallback(async (u: string, p: string): Promise<void> => {
    const res = await authApi.login(u, p);
    setAccessToken(res.data.access_token);
    setIsAuthenticated(true);
    setUsername(u);
    setFullName(res.data.full_name);
    setRole(res.data.role);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await authApi.logout().catch(() => {});
    setAccessToken(null);
    setIsAuthenticated(false);
    setUsername(null);
    setFullName(null);
    setRole(null);
  }, []);

  const hasRole = useCallback(
    (required: Role): boolean => {
      if (!role) return false;
      return (ROLE_LEVELS[role] ?? 0) >= (ROLE_LEVELS[required] ?? 99);
    },
    [role]
  );

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, isInitializing, username, fullName, role, login, logout, hasRole }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => useContext(AuthContext);
