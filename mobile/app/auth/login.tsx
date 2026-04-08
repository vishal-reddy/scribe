import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
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
      // For demo: create a mock token
      // TODO: Replace with actual Cloudflare Access OAuth flow
      const mockToken = `mock_token_${Date.now()}`;
      await login(mockToken, email);
      router.replace('/');
    } catch (error) {
      Alert.alert('Error', 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View className="flex-1 justify-center items-center p-6 bg-white">
      <Text className="text-3xl font-bold mb-8">Scribe</Text>
      <Text className="text-gray-600 mb-6 text-center">
        Sign in to access your documents
      </Text>
      
      <TextInput
        className="w-full border border-gray-300 rounded-lg px-4 py-3 mb-4"
        placeholder="Email address"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        editable={!isLoading}
      />

      <TouchableOpacity
        className={`w-full bg-primary rounded-lg py-3 ${isLoading ? 'opacity-50' : ''}`}
        onPress={handleLogin}
        disabled={isLoading}
      >
        <Text className="text-white text-center font-semibold">
          {isLoading ? 'Signing in...' : 'Sign In'}
        </Text>
      </TouchableOpacity>

      <Text className="mt-6 text-gray-500 text-sm text-center">
        TODO: Integrate Cloudflare Access OAuth
      </Text>
    </View>
  );
}
