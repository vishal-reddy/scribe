import { Tabs } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { AuthProvider } from '../lib/auth-context';
import { RootErrorBoundary } from '../components/ErrorBoundary';
import { ToastProvider } from '../components/Toast';
import '../global.css';

const BURGUNDY = '#971B2F';
const WARM_GRAY = '#9E9A96';

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5,
        retry: 1,
      },
    },
  }));

  return (
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <StatusBar style="light" />
            <Tabs
              screenOptions={{
                headerStyle: { backgroundColor: BURGUNDY },
                headerTintColor: '#FFFFFF',
                headerTitleStyle: { fontWeight: '600' },
                tabBarActiveTintColor: BURGUNDY,
                tabBarInactiveTintColor: WARM_GRAY,
                tabBarStyle: {
                  borderTopWidth: 0.5,
                  borderTopColor: '#E5E1DC',
                  backgroundColor: '#FFFFFF',
                  elevation: 8,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: -2 },
                  shadowOpacity: 0.06,
                  shadowRadius: 4,
                  paddingTop: 4,
                },
                tabBarLabelStyle: {
                  fontSize: 11,
                  fontWeight: '500',
                },
              }}
            >
              <Tabs.Screen
                name="index"
                options={{
                  title: 'Documents',
                  tabBarIcon: ({ color, size }) => (
                    <Ionicons name="document-text-outline" size={size} color={color} />
                  ),
                }}
              />
              <Tabs.Screen
                name="artifacts"
                options={{
                  title: 'Artifacts',
                  tabBarIcon: ({ color, size }) => (
                    <Ionicons name="sparkles-outline" size={size} color={color} />
                  ),
                }}
              />
              <Tabs.Screen
                name="claude"
                options={{
                  title: 'Claude',
                  tabBarIcon: ({ color, size }) => (
                    <Ionicons name="chatbubble-ellipses-outline" size={size} color={color} />
                  ),
                }}
              />
              <Tabs.Screen
                name="settings"
                options={{
                  title: 'Settings',
                  tabBarIcon: ({ color, size }) => (
                    <Ionicons name="settings-outline" size={size} color={color} />
                  ),
                }}
              />
              <Tabs.Screen
                name="auth/login"
                options={{ href: null, headerShown: false }}
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
