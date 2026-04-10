import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  userEmail: string | null; // backward compat
  requestOtp: (email: string) => Promise<{ devOtp?: string }>;
  verifyOtp: (email: string, otp: string) => Promise<void>;
  logout: () => Promise<void>;
  login: (email: string) => Promise<void>; // kept for backward compat
  sessionToken: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8787';

const storage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return;
    }
    return SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      return;
    }
    return SecureStore.deleteItemAsync(key);
  },
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    loadAuth();
  }, []);

  const loadAuth = async () => {
    try {
      const token = await storage.getItem('session_token');
      const userJson = await storage.getItem('user_data');

      if (token && userJson) {
        const userData = JSON.parse(userJson);
        setSessionToken(token);
        setUser(userData);
        setIsAuthenticated(true);
      } else {
        // Check legacy email-only auth
        const email = await storage.getItem('user_email');
        if (email) {
          setUser({ id: '', email, name: email.split('@')[0] });
          setIsAuthenticated(true);
        }
      }
    } catch (error) {
      console.error('Error loading auth:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const requestOtp = useCallback(async (email: string): Promise<{ devOtp?: string }> => {
    const resp = await fetch(`${API_URL}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Failed to send code' }));
      throw new Error(err.error || 'Failed to send verification code');
    }

    const data = await resp.json();
    return { devOtp: data.devOtp };
  }, []);

  const verifyOtp = useCallback(async (email: string, otp: string) => {
    const resp = await fetch(`${API_URL}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Verification failed' }));
      throw new Error(err.error || 'Invalid code');
    }

    const data = await resp.json();

    // Store session
    await storage.setItem('session_token', data.token);
    await storage.setItem('user_data', JSON.stringify(data.user));
    await storage.setItem('user_email', data.user.email); // backward compat

    setSessionToken(data.token);
    setUser(data.user);
    setIsAuthenticated(true);
    queryClient.invalidateQueries();
  }, [queryClient]);

  // Legacy login for backward compat
  const login = useCallback(async (email: string) => {
    await storage.setItem('user_email', email);
    setUser({ id: '', email, name: email.split('@')[0] });
    setIsAuthenticated(true);
    queryClient.invalidateQueries();
  }, [queryClient]);

  const logout = useCallback(async () => {
    // Call logout endpoint if we have a token
    if (sessionToken) {
      try {
        await fetch(`${API_URL}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionToken}`,
          },
        });
      } catch {} // Best effort
    }

    await storage.removeItem('session_token');
    await storage.removeItem('user_data');
    await storage.removeItem('user_email');
    setSessionToken(null);
    setUser(null);
    setIsAuthenticated(false);
    queryClient.clear();
  }, [queryClient, sessionToken]);

  const userEmail = user?.email || null;

  return (
    <AuthContext.Provider value={{
      isAuthenticated, isLoading, user, userEmail,
      requestOtp, verifyOtp, logout, login, sessionToken
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
