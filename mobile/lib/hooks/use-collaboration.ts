import { useEffect, useState, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { documentsService } from '../services/documents';

interface CollaborationState {
  isClaudeEditing: boolean;
  lastEditor: 'user' | 'claude' | null;
  lastEditedAt: Date | null;
  collaboratorCount: number;
}

const POLL_INTERVAL_MS = 4_000;
const CLAUDE_EDITING_TIMEOUT_MS = 30_000;

/**
 * Polls document metadata to detect Claude edits and track collaboration state.
 * Triggers a React Query refetch when a Claude edit is detected so the editor
 * picks up the new content.
 */
export function useCollaboration(documentId: string) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<CollaborationState>({
    isClaudeEditing: false,
    lastEditor: null,
    lastEditedAt: null,
    collaboratorCount: 1,
  });

  const prevUpdatedAtRef = useRef<string | null>(null);
  const claudeTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const dismissClaudeEditing = useCallback(() => {
    setState((s) => ({ ...s, isClaudeEditing: false }));
    if (claudeTimeoutRef.current) {
      clearTimeout(claudeTimeoutRef.current);
      claudeTimeoutRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    if (!documentId) return;

    const poll = async () => {
      try {
        const doc = await documentsService.get(documentId);
        const updatedAt = doc.updatedAt;
        const lastEditor = doc.lastEditedBy === 'claude' ? 'claude' : 'user';

        const isNewEdit =
          prevUpdatedAtRef.current !== null &&
          updatedAt !== prevUpdatedAtRef.current;

        prevUpdatedAtRef.current = updatedAt;

        const isClaudeEdit = isNewEdit && lastEditor === 'claude';

        if (isClaudeEdit) {
          // Invalidate the document query so editor picks up changes
          queryClient.invalidateQueries({ queryKey: ['documents', documentId] });
        }

        // Determine if Claude is "currently editing":
        // either we just detected a new Claude edit, or the last edit was by Claude
        // within the recent timeout window.
        const editAge = Date.now() - new Date(updatedAt).getTime();
        const claudeRecentlyEdited =
          lastEditor === 'claude' && editAge < CLAUDE_EDITING_TIMEOUT_MS;

        setState((prev) => {
          const isClaudeEditing = isClaudeEdit || (claudeRecentlyEdited && prev.isClaudeEditing);
          return {
            isClaudeEditing: isClaudeEdit ? true : prev.isClaudeEditing,
            lastEditor,
            lastEditedAt: new Date(updatedAt),
            // 1 for user + 1 if Claude edited recently
            collaboratorCount: claudeRecentlyEdited ? 2 : 1,
          };
        });

        // Auto-dismiss "Claude is editing" after 5 seconds
        if (isClaudeEdit) {
          if (claudeTimeoutRef.current) clearTimeout(claudeTimeoutRef.current);
          claudeTimeoutRef.current = setTimeout(() => {
            setState((s) => ({ ...s, isClaudeEditing: false }));
          }, 5_000);
        }
      } catch {
        // Silently ignore poll errors
      }
    };

    // Initial poll
    poll();

    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      if (claudeTimeoutRef.current) clearTimeout(claudeTimeoutRef.current);
    };
  }, [documentId, queryClient]);

  return {
    ...state,
    dismissClaudeEditing,
  };
}
