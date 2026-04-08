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
import { useAuth } from '../lib/auth-context';
import { useSettings } from '../lib/use-settings';

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

  const SettingItem = ({
    title,
    value,
    onPress,
  }: {
    title: string;
    value?: string;
    onPress?: () => void;
  }) => (
    <TouchableOpacity
      className="flex-row justify-between items-center py-4 border-b border-gray-200"
      onPress={onPress}
    >
      <Text className="text-base">{title}</Text>
      {value && <Text className="text-gray-500">{value}</Text>}
    </TouchableOpacity>
  );

  const SettingSwitch = ({
    title,
    value,
    onValueChange,
  }: {
    title: string;
    value: boolean;
    onValueChange: (value: boolean) => void;
  }) => (
    <View className="flex-row justify-between items-center py-4 border-b border-gray-200">
      <Text className="text-base">{title}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );

  return (
    <ScrollView className="flex-1 bg-white">
      {/* Account Section */}
      <View className="p-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Account
        </Text>
        <View className="bg-white rounded-lg border border-gray-200 px-4">
          <View className="py-4 border-b border-gray-200">
            <Text className="text-sm text-gray-500">Email</Text>
            <Text className="text-base mt-1">{userEmail || 'Not logged in'}</Text>
          </View>
          <TouchableOpacity
            className="py-4"
            onPress={handleLogout}
          >
            <Text className="text-red-600 font-semibold">Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Appearance Section */}
      <View className="p-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Appearance
        </Text>
        <View className="bg-white rounded-lg border border-gray-200 px-4">
          <SettingSwitch
            title="Dark Mode"
            value={settings.darkMode}
            onValueChange={(value) => updateSettings({ darkMode: value })}
          />
          <SettingItem
            title="Font Size"
            value={settings.fontSize}
            onPress={() => {
              Alert.alert('Font Size', 'Choose font size', [
                { text: 'Small', onPress: () => updateSettings({ fontSize: 'small' }) },
                { text: 'Medium', onPress: () => updateSettings({ fontSize: 'medium' }) },
                { text: 'Large', onPress: () => updateSettings({ fontSize: 'large' }) },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}
          />
        </View>
      </View>

      {/* Editor Settings */}
      <View className="p-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Editor
        </Text>
        <View className="bg-white rounded-lg border border-gray-200 px-4">
          <SettingItem title="Line Height" value="1.5" />
          <SettingItem title="Default Format" value="Markdown" />
        </View>
      </View>

      {/* Claude Settings */}
      <View className="p-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          Claude Integration
        </Text>
        <View className="bg-white rounded-lg border border-gray-200 px-4">
          <SettingSwitch
            title="Auto-accept edits"
            value={settings.autoAcceptEdits}
            onValueChange={(value) => updateSettings({ autoAcceptEdits: value })}
          />
          <SettingSwitch
            title="Notifications"
            value={settings.notificationsEnabled}
            onValueChange={(value) => updateSettings({ notificationsEnabled: value })}
          />
        </View>
      </View>

      {/* About Section */}
      <View className="p-4">
        <Text className="text-sm font-semibold text-gray-500 uppercase mb-2">
          About
        </Text>
        <View className="bg-white rounded-lg border border-gray-200 px-4">
          <SettingItem title="Version" value="1.0.0" />
          <SettingItem title="Privacy Policy" />
          <SettingItem title="Terms of Service" />
        </View>
      </View>

      {/* Spacing at bottom */}
      <View className="h-8" />
    </ScrollView>
  );
}
