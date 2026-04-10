import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth-context';
import { documentsService } from '../services/documents';
import type { CreateDocumentInput, UpdateDocumentInput } from '../services/documents';

export function useDocuments() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ['documents'],
    queryFn: () => documentsService.list(),
    enabled: isAuthenticated,
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: ['documents', id],
    queryFn: () => documentsService.get(id),
    enabled: !!id,
  });
}

export function useCreateDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateDocumentInput) => documentsService.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

export function useUpdateDocument(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateDocumentInput) => documentsService.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['documents', id] });
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => documentsService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

export function useDocumentVersions(id: string) {
  return useQuery({
    queryKey: ['documents', id, 'versions'],
    queryFn: () => documentsService.getVersions(id),
    enabled: !!id,
  });
}
