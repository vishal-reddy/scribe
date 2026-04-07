import { Tabs } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Text } from 'react-native';
import { AuthProvider } from '../lib/auth-context';
import { RootErrorBoundary } from '../components/ErrorBoundary';
import { ToastProvider } from '../components/Toast';
import '../global.css';

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes
        retry: 1,
      },
    },
  }));

  return (
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <Tabs>
          <Tabs.Screen 
            name="index" 
            options={{ 
              title: 'Documents',
              tabBarIcon: ({ color }) => <Text style={{ color }}>📄</Text>,
            }} 
          />
          <Tabs.Screen 
            name="artifacts" 
            options={{ 
              title: 'Artifacts',
              tabBarIcon: ({ color }) => <Text style={{ color }}>🎨</Text>,
            }} 
          />
          <Tabs.Screen 
            name="claude" 
            options={{ 
              title: 'Claude',
              tabBarIcon: ({ color }) => <Text style={{ color }}>💬</Text>,
            }} 
          />
          <Tabs.Screen 
            name="settings" 
            options={{ 
              title: 'Settings',
              tabBarIcon: ({ color }) => <Text style={{ color }}>⚙️</Text>,
            }} 
          />
          <Tabs.Screen 
            name="auth/login" 
            options={{ href: null }} 
          />
          <Tabs.Screen 
            name="document/[id]" 
            options={{ href: null }} 
          />
          <Tabs.Screen 
            name="history/[id]" 
            options={{ href: null }} 
          />
        </Tabs>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </RootErrorBoundary>
  );
}
