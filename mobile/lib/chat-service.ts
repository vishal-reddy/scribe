import apiClient from './api-client';
import type { Message } from './types';

export async function sendClaudePrompt(
  prompt: string,
  documentId?: string
): Promise<string> {
  const data = await apiClient.post<{ response?: string; message?: string }>('/api/claude/prompt', {
    prompt,
    documentId,
  });
  return data.response || data.message || '';
}

export async function getClaudeArtifacts(): Promise<any[]> {
  const data = await apiClient.get<{ artifacts: any[] }>('/api/claude/artifacts');
  return data.artifacts || [];
}
