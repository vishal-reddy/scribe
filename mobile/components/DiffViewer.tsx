import React, { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';

interface DiffViewerProps {
  oldText: string;
  newText: string;
}

type DiffLineType = 'added' | 'removed' | 'unchanged';

interface DiffLine {
  type: DiffLineType;
  text: string;
}

/**
 * LCS-based line diff: computes the longest common subsequence of lines,
 * then derives added/removed/unchanged from the result.
 */
function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'unchanged', text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'added', text: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: 'removed', text: oldLines[i - 1] });
      i--;
    }
  }

  return result.reverse();
}

const lineStyles: Record<DiffLineType, { bg: string; prefix: string; textColor: string }> = {
  added: { bg: 'bg-green-100', prefix: '+', textColor: 'text-green-800' },
  removed: { bg: 'bg-red-100', prefix: '-', textColor: 'text-red-800' },
  unchanged: { bg: 'bg-white', prefix: ' ', textColor: 'text-gray-700' },
};

export default function DiffViewer({ oldText, newText }: DiffViewerProps) {
  const diffLines = useMemo(() => computeDiff(oldText, newText), [oldText, newText]);

  if (diffLines.length === 0) {
    return (
      <View className="p-4 items-center">
        <Text className="text-gray-500">No differences</Text>
      </View>
    );
  }

  const hasChanges = diffLines.some((l) => l.type !== 'unchanged');
  if (!hasChanges) {
    return (
      <View className="p-4 items-center">
        <Text className="text-gray-500">No differences — content is identical</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" nestedScrollEnabled>
      <View className="p-2">
        {diffLines.map((line, idx) => {
          const style = lineStyles[line.type];
          return (
            <View key={idx} className={`flex-row px-2 py-0.5 ${style.bg}`}>
              <Text className={`w-5 font-mono text-xs ${style.textColor}`}>{style.prefix}</Text>
              <Text className={`flex-1 font-mono text-xs ${style.textColor}`} numberOfLines={1}>
                {line.text || ' '}
              </Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
