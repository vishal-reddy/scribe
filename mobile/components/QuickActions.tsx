import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';

interface QuickActionsProps {
  onAction: (action: string) => void;
}

const suggestions = [
  'Expand this section with more details',
  'Simplify this paragraph',
  'Add examples',
  'Create an outline',
  'Fix grammar and spelling',
  'Make it more concise',
];

export default function QuickActions({ onAction }: QuickActionsProps) {
  return (
    <ScrollView
      horizontal
      className="px-4 py-2"
      showsHorizontalScrollIndicator={false}
    >
      {suggestions.map((suggestion, index) => (
        <TouchableOpacity
          key={index}
          className="bg-gray-100 px-3 py-2 rounded-full mr-2"
          onPress={() => onAction(suggestion)}
        >
          <Text className="text-sm">{suggestion}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
