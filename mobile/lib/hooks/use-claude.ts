import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { claudeService } from '../services/claude';
import type { ClaudePromptInput } from '../services/claude';

export function useClaudePrompt() {
  return useMutation({
    mutationFn: (input: ClaudePromptInput) => claudeService.sendPrompt(input),
  });
}

export function useClaudeArtifacts() {
  return useQuery({
    queryKey: ['claude', 'artifacts'],
    queryFn: () => claudeService.listArtifacts(),
  });
}

export function useClaudeArtifact(id: string) {
  return useQuery({
    queryKey: ['claude', 'artifacts', id],
    queryFn: () => claudeService.getArtifact(id),
    enabled: !!id,
  });
}
