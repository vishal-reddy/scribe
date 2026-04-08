import apiClient from './api-client';
import type { Message } from './types';

export async function sendClaudePrompt(
  prompt: string,
  documentId?: string
): Promise<string> {
  try {
    const response = await apiClient.post('/api/claude/prompt', {
      prompt,
      documentId,
    });
    return response.data.response || response.data.message;
  } catch (error) {
    console.error('Error sending Claude prompt:', error);
    throw new Error('Failed to send message to Claude');
  }
}

export async function getClaudeArtifacts(): Promise<any[]> {
  try {
    const response = await apiClient.get('/api/claude/artifacts');
    return response.data.artifacts || [];
  } catch (error) {
    console.error('Error fetching artifacts:', error);
    return [];
  }
}
