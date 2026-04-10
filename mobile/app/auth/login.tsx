import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth-context';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleLogin = async () => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email');
      return;
    }

    setIsLoading(true);
    try {
      await login(email);
      router.replace('/');
    } catch (error) {
      Alert.alert('Error', 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#971B2F' }}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Burgundy branded header */}
        <View
          style={{ flex: 1, backgroundColor: '#971B2F', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}
        >
          <Ionicons name="create-outline" size={48} color="rgba(255,255,255,0.85)" style={{ marginBottom: 16 }} />
          <Text style={{ fontSize: 40, fontWeight: '700', color: '#FFFFFF', letterSpacing: 1, marginBottom: 6 }}>
            Scribe
          </Text>
          <Text style={{ fontSize: 16, color: 'rgba(255,255,255,0.75)', fontWeight: '400' }}>
            Your AI Writing Companion
          </Text>
        </View>

        {/* Card-style form area */}
        <View
          style={{
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 24,
            paddingTop: 32,
            paddingBottom: 40,
          }}
        >
          <Text style={{ fontSize: 22, fontWeight: '700', color: '#1E1E1E', marginBottom: 4 }}>
            Welcome back
          </Text>
          <Text style={{ fontSize: 14, color: '#7A7672', marginBottom: 24 }}>
            Sign in to access your documents
          </Text>

          <TextInput
            style={{
              width: '100%',
              backgroundColor: '#F7F5F2',
              borderRadius: 12,
              paddingHorizontal: 16,
              paddingVertical: 14,
              fontSize: 16,
              color: '#1E1E1E',
              marginBottom: 16,
            }}
            placeholder="Email address"
            placeholderTextColor="#A8A4A0"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            editable={!isLoading}
          />

          <TouchableOpacity
            style={{
              width: '100%',
              backgroundColor: '#971B2F',
              borderRadius: 12,
              paddingVertical: 15,
              alignItems: 'center',
              opacity: isLoading ? 0.6 : 1,
            }}
            onPress={handleLogin}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Text>
          </TouchableOpacity>

          <Text style={{ marginTop: 24, textAlign: 'center', fontSize: 12, color: '#B0ACA8' }}>
            Powered by Claude
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
