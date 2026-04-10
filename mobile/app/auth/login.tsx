import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth-context';

type Step = 'email' | 'otp';

export default function LoginScreen() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const { requestOtp, verifyOtp } = useAuth();
  const router = useRouter();
  const otpRef = useRef<TextInput>(null);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleRequestOtp = async () => {
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const result = await requestOtp(email.toLowerCase().trim());
      setStep('otp');
      setCountdown(300); // 5 minutes
      // In dev, auto-fill OTP
      if (result.devOtp) {
        setOtp(result.devOtp);
      }
      setTimeout(() => otpRef.current?.focus(), 300);
    } catch (err: any) {
      setError(err.message || 'Failed to send code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      await verifyOtp(email.toLowerCase().trim(), otp);
      router.replace('/');
    } catch (err: any) {
      setError(err.message || 'Invalid code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setOtp('');
    setIsLoading(true);
    try {
      const result = await requestOtp(email.toLowerCase().trim());
      setCountdown(300);
      if (result.devOtp) {
        setOtp(result.devOtp);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to resend code');
    } finally {
      setIsLoading(false);
    }
  };

  const formatCountdown = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#971B2F' }}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Burgundy branded header */}
        <View style={{ flex: 1, backgroundColor: '#971B2F', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}>
          <Ionicons name="create-outline" size={48} color="rgba(255,255,255,0.85)" style={{ marginBottom: 16 }} />
          <Text style={{ fontSize: 40, fontWeight: '700', color: '#FFFFFF', letterSpacing: 1, marginBottom: 6 }}>
            Scribe
          </Text>
          <Text style={{ fontSize: 16, color: 'rgba(255,255,255,0.75)', fontWeight: '400' }}>
            Your AI Writing Companion
          </Text>
        </View>

        {/* Card-style form */}
        <View style={{
          backgroundColor: '#FFFFFF',
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          paddingHorizontal: 24,
          paddingTop: 32,
          paddingBottom: 40,
        }}>
          {step === 'email' ? (
            <>
              <Text style={{ fontSize: 22, fontWeight: '700', color: '#1E1E1E', marginBottom: 4 }}>
                Welcome to Scribe
              </Text>
              <Text style={{ fontSize: 14, color: '#7A7672', marginBottom: 24 }}>
                Enter your email to get started
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
                  marginBottom: 8,
                  borderWidth: error ? 1 : 0,
                  borderColor: '#971B2F',
                }}
                placeholder="you@example.com"
                placeholderTextColor="#A8A4A0"
                value={email}
                onChangeText={(t) => { setEmail(t); setError(''); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                editable={!isLoading}
                onSubmitEditing={handleRequestOtp}
                returnKeyType="next"
              />

              {error ? (
                <Text style={{ color: '#971B2F', fontSize: 13, marginBottom: 8 }}>{error}</Text>
              ) : null}

              <TouchableOpacity
                style={{
                  width: '100%',
                  backgroundColor: '#971B2F',
                  borderRadius: 12,
                  paddingVertical: 15,
                  alignItems: 'center',
                  marginTop: 8,
                  opacity: isLoading ? 0.6 : 1,
                }}
                onPress={handleRequestOtp}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
                    Continue
                  </Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => { setStep('email'); setError(''); setOtp(''); }}
                style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}
              >
                <Ionicons name="arrow-back" size={20} color="#971B2F" />
                <Text style={{ color: '#971B2F', fontSize: 14, fontWeight: '500', marginLeft: 4 }}>Back</Text>
              </TouchableOpacity>

              <Text style={{ fontSize: 22, fontWeight: '700', color: '#1E1E1E', marginBottom: 4 }}>
                Check your email
              </Text>
              <Text style={{ fontSize: 14, color: '#7A7672', marginBottom: 24 }}>
                We sent a 6-digit code to {email}
              </Text>

              <TextInput
                ref={otpRef}
                style={{
                  width: '100%',
                  backgroundColor: '#F7F5F2',
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  fontSize: 24,
                  fontWeight: '700',
                  color: '#1E1E1E',
                  marginBottom: 8,
                  textAlign: 'center',
                  letterSpacing: 8,
                  borderWidth: error ? 1 : 0,
                  borderColor: '#971B2F',
                }}
                placeholder="000000"
                placeholderTextColor="#A8A4A0"
                value={otp}
                onChangeText={(t) => { setOtp(t.replace(/\D/g, '').slice(0, 6)); setError(''); }}
                keyboardType="number-pad"
                maxLength={6}
                editable={!isLoading}
                onSubmitEditing={handleVerifyOtp}
              />

              {error ? (
                <Text style={{ color: '#971B2F', fontSize: 13, marginBottom: 8 }}>{error}</Text>
              ) : null}

              {countdown > 0 && (
                <Text style={{ textAlign: 'center', color: '#7A7672', fontSize: 13, marginBottom: 8 }}>
                  Code expires in {formatCountdown(countdown)}
                </Text>
              )}

              <TouchableOpacity
                style={{
                  width: '100%',
                  backgroundColor: '#971B2F',
                  borderRadius: 12,
                  paddingVertical: 15,
                  alignItems: 'center',
                  marginTop: 8,
                  opacity: isLoading ? 0.6 : 1,
                }}
                onPress={handleVerifyOtp}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
                    Verify & Sign In
                  </Text>
                )}
              </TouchableOpacity>

              {countdown === 0 && (
                <TouchableOpacity onPress={handleResend} style={{ marginTop: 16, alignItems: 'center' }}>
                  <Text style={{ color: '#971B2F', fontSize: 14, fontWeight: '500' }}>
                    Resend code
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}

          <Text style={{ marginTop: 24, textAlign: 'center', fontSize: 12, color: '#B0ACA8' }}>
            Secured with email verification
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
