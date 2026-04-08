import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/auth-context';
import { useSettings } from '../lib/use-settings';

const BURGUNDY = '#971B2F';
const CREAM_BG = '#FAFAF7';

export default function SettingsScreen() {
  const { userEmail, logout } = useAuth();
  const router = useRouter();
  const { settings, updateSettings } = useSettings();

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/auth/login');
          },
        },
      ]
    );
  };

  // Extract initials from email
  const initials = (userEmail || 'U')
    .split('@')[0]
    .split(/[._-]/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  const SettingItem = ({
    title,
    value,
    onPress,
    icon,
  }: {
    title: string;
    value?: string;
    onPress?: () => void;
    icon?: keyof typeof Ionicons.glyphMap;
  }) => (
    <TouchableOpacity
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
        borderBottomWidth: 0.5,
        borderBottomColor: '#F0EDE8',
      }}
      onPress={onPress}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {icon && <Ionicons name={icon} size={18} color="#7A7672" style={{ marginRight: 10 }} />}
        <Text style={{ fontSize: 15, color: '#1E1E1E' }}>{title}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {value && <Text style={{ fontSize: 14, color: '#9E9A96', marginRight: 4 }}>{value}</Text>}
        {onPress && <Ionicons name="chevron-forward" size={16} color="#D5D1CC" />}
      </View>
    </TouchableOpacity>
  );

  const SettingSwitch = ({
    title,
    value,
    onValueChange,
    icon,
  }: {
    title: string;
    value: boolean;
    onValueChange: (value: boolean) => void;
    icon?: keyof typeof Ionicons.glyphMap;
  }) => (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
        borderBottomWidth: 0.5,
        borderBottomColor: '#F0EDE8',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {icon && <Ionicons name={icon} size={18} color="#7A7672" style={{ marginRight: 10 }} />}
        <Text style={{ fontSize: 15, color: '#1E1E1E' }}>{title}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#E0DCD7', true: 'rgba(151,27,47,0.35)' }}
        thumbColor={value ? BURGUNDY : '#F4F3F4'}
        ios_backgroundColor="#E0DCD7"
      />
    </View>
  );

  const SectionHeader = ({ title }: { title: string }) => (
    <Text
      style={{
        fontSize: 12,
        fontWeight: '600',
        color: '#9E9A96',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        marginBottom: 8,
      }}
    >
      {title}
    </Text>
  );

  const SectionCard = ({ children }: { children: React.ReactNode }) => (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        paddingHorizontal: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 6,
        elevation: 2,
      }}
    >
      {children}
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: CREAM_BG }}>
      {/* User avatar / email header */}
      <View style={{ alignItems: 'center', paddingTop: 24, paddingBottom: 20 }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: BURGUNDY,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '700' }}>{initials}</Text>
        </View>
        <Text style={{ fontSize: 16, fontWeight: '600', color: '#1E1E1E' }}>
          {userEmail || 'Not logged in'}
        </Text>
      </View>

      {/* Account Section */}
      <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
        <SectionHeader title="Account" />
        <SectionCard>
          <SettingItem title="Email" value={userEmail || 'Not set'} icon="mail-outline" />
          <TouchableOpacity
            style={{ paddingVertical: 14 }}
            onPress={handleLogout}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="log-out-outline" size={18} color="#DC2626" style={{ marginRight: 10 }} />
              <Text style={{ color: '#DC2626', fontWeight: '600', fontSize: 15 }}>Logout</Text>
            </View>
          </TouchableOpacity>
        </SectionCard>
      </View>

      {/* Appearance Section */}
      <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
        <SectionHeader title="Appearance" />
        <SectionCard>
          <SettingSwitch
            title="Dark Mode"
            value={settings.darkMode}
            onValueChange={(value) => updateSettings({ darkMode: value })}
            icon="moon-outline"
          />
          <SettingItem
            title="Font Size"
            value={settings.fontSize}
            icon="text-outline"
            onPress={() => {
              Alert.alert('Font Size', 'Choose font size', [
                { text: 'Small', onPress: () => updateSettings({ fontSize: 'small' }) },
                { text: 'Medium', onPress: () => updateSettings({ fontSize: 'medium' }) },
                { text: 'Large', onPress: () => updateSettings({ fontSize: 'large' }) },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}
          />
        </SectionCard>
      </View>

      {/* Editor Settings */}
      <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
        <SectionHeader title="Editor" />
        <SectionCard>
          <SettingItem title="Line Height" value="1.5" icon="resize-outline" />
          <SettingItem title="Default Format" value="Markdown" icon="code-slash-outline" />
        </SectionCard>
      </View>

      {/* Claude Settings */}
      <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
        <SectionHeader title="Claude Integration" />
        <SectionCard>
          <SettingSwitch
            title="Auto-accept edits"
            value={settings.autoAcceptEdits}
            onValueChange={(value) => updateSettings({ autoAcceptEdits: value })}
            icon="checkmark-done-outline"
          />
          <SettingSwitch
            title="Notifications"
            value={settings.notificationsEnabled}
            onValueChange={(value) => updateSettings({ notificationsEnabled: value })}
            icon="notifications-outline"
          />
        </SectionCard>
      </View>

      {/* About Section */}
      <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
        <SectionHeader title="About" />
        <SectionCard>
          <SettingItem title="Version" value="1.0.0" icon="information-circle-outline" />
          <SettingItem title="Privacy Policy" icon="shield-outline" onPress={() => {}} />
          <SettingItem title="Terms of Service" icon="document-text-outline" onPress={() => {}} />
        </SectionCard>
      </View>

      {/* Footer tagline */}
      <View style={{ alignItems: 'center', paddingVertical: 16, paddingBottom: 32 }}>
        <Text style={{ fontSize: 12, color: '#B0ACA8' }}>Scribe — Powered by Claude</Text>
      </View>
    </ScrollView>
  );
}
