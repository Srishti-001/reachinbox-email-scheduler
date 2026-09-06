'use client';

import React, { createContext, useContext, useEffect, useReducer, useCallback } from 'react';
import { User } from '@/types';
import api from '@/lib/api';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

type AuthAction =
  | { type: 'LOADING' }
  | { type: 'SET_USER'; user: User }
  | { type: 'LOGOUT' }
  | { type: 'ERROR'; error: string };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOADING':  return { ...state, loading: true,  error: null };
    case 'SET_USER': return { user: action.user, loading: false, error: null };
    case 'LOGOUT':   return { user: null,        loading: false, error: null };
    case 'ERROR':    return { ...state,           loading: false, error: action.error };
    default:         return state;
  }
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  logout: () => Promise<void>;
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, {
    user:    null,
    loading: true,
    error:   null,
  });

  const fetchUser = useCallback(async () => {
    dispatch({ type: 'LOADING' });
    try {
      const res = await api.get('/auth/me');
      dispatch({ type: 'SET_USER', user: res.data.data });
    } catch {
      dispatch({ type: 'LOGOUT' });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.get('/auth/logout');
    } catch {
      // ignore — clear local state regardless
    }
    dispatch({ type: 'LOGOUT' });
    window.location.href = '/login';
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  return (
    <AuthContext.Provider
      value={{ user: state.user, loading: state.loading, error: state.error, logout, refetch: fetchUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
