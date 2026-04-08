import React from 'react';
import { View, Text } from 'react-native';
import type { Message } from '../lib/types';

interface ChatMessageProps {
  message: Message;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <View className={`mb-4 ${isUser ? 'items-end' : 'items-start'}`}>
      <View
        className={`max-w-[80%] p-3 rounded-lg ${
          isUser ? 'bg-primary' : 'bg-gray-200'
        }`}
      >
        <Text className={isUser ? 'text-white' : 'text-gray-900'}>
          {message.content}
        </Text>
      </View>
      <Text className="text-xs text-gray-500 mt-1">
        {message.timestamp.toLocaleTimeString()}
      </Text>
    </View>
  );
}
