import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { versionsService } from '../services/versions';

export function useVersions(documentId: string) {
  return useQuery({
    queryKey: ['documents', documentId, 'versions'],
    queryFn: () => versionsService.list(documentId),
    enabled: !!documentId,
  });
}

export function useCreateVersion(documentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => versionsService.create(documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', documentId, 'versions'] });
    },
  });
}

export function useRestoreVersion(documentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (markdown: string) => versionsService.restore(documentId, markdown),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', documentId] });
      queryClient.invalidateQueries({ queryKey: ['documents', documentId, 'versions'] });
    },
  });
}
