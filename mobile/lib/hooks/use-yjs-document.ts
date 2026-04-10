import { useEffect, useState, useRef, useCallback } from 'react';
import apiClient from '../api-client';

/**
 * Document sync hook — polls the REST API for content.
 * Y.js WebSocket sync is not used since API key auth can't be passed on WS upgrade.
 */
export function useYjsDocument(documentId: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [markdown, setMarkdown] = useState('');
  const contentRef = useRef('');
  const isSavingRef = useRef(false);
  const isDirtyRef = useRef(false);

  const fetchContent = useCallback(async () => {
    if (!documentId || isSavingRef.current || isDirtyRef.current) return;
    try {
      const data = await apiClient.get<{ document: { markdown: string } }>(`/api/documents/${documentId}`);
      const serverMarkdown = data.document?.markdown || '';
      if (serverMarkdown !== contentRef.current) {
        contentRef.current = serverMarkdown;
        setMarkdown(serverMarkdown);
      }
      setIsConnected(true);
    } catch (error) {
      console.error('Sync fetch error:', error);
      setIsConnected(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (!documentId) return;
    fetchContent();
    const interval = setInterval(fetchContent, 5000);
    return () => clearInterval(interval);
  }, [documentId, fetchContent]);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateContent = useCallback(
    (newMarkdown: string) => {
      contentRef.current = newMarkdown;
      setMarkdown(newMarkdown);
      isDirtyRef.current = true;

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

      saveTimeoutRef.current = setTimeout(async () => {
        if (!documentId) return;
        isSavingRef.current = true;
        try {
          await apiClient.patch(`/api/documents/${documentId}`, { markdown: newMarkdown });
          setIsConnected(true);
        } catch (error) {
          console.error('Save error:', error);
          setIsConnected(false);
        } finally {
          isSavingRef.current = false;
          isDirtyRef.current = false;
        }
      }, 1000);
    },
    [documentId]
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  return {
    markdown,
    isConnected,
    updateContent,
    ydoc: null,
  };
}

export function useSimpleYjsDocument(documentId: string) {
  const { markdown, isConnected, updateContent } = useYjsDocument(documentId);
  return {
    content: markdown,
    updateContent,
    lastSynced: isConnected ? new Date() : null,
    isSyncing: false,
  };
}
