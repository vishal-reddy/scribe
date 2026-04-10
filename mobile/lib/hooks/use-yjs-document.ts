import { useEffect, useState, useRef, useCallback } from 'react';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8787';
const API_KEY = process.env.EXPO_PUBLIC_API_KEY || '';

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  try {
    if (typeof localStorage !== 'undefined') {
      const email = localStorage.getItem('user_email');
      if (email) headers['X-User-Email'] = email;
    }
  } catch {}
  return headers;
}

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

  // Fetch document content
  const fetchContent = useCallback(async () => {
    // Skip polling while user has unsaved edits or save is in progress
    if (!documentId || isSavingRef.current || isDirtyRef.current) return;
    try {
      const resp = await fetch(`${API_URL}/api/documents/${documentId}`, {
        headers: getHeaders(),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const serverMarkdown = data.document?.markdown || '';
      // Only update if content differs from what we have
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

    // Initial fetch
    fetchContent();

    // Poll every 5 seconds
    const interval = setInterval(fetchContent, 5000);

    return () => clearInterval(interval);
  }, [documentId, fetchContent]);

  // Save content to server (debounced)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateContent = useCallback(
    (newMarkdown: string) => {
      contentRef.current = newMarkdown;
      setMarkdown(newMarkdown);
      isDirtyRef.current = true;

      // Debounce saves — wait 1 second after last edit
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        if (!documentId) return;
        isSavingRef.current = true;
        try {
          await fetch(`${API_URL}/api/documents/${documentId}`, {
            method: 'PATCH',
            headers: getHeaders(),
            body: JSON.stringify({ markdown: newMarkdown }),
          });
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

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    markdown,
    isConnected,
    updateContent,
    ydoc: null,
  };
}

/**
 * Simple polling sync (kept for compatibility)
 */
export function useSimpleYjsDocument(documentId: string) {
  const { markdown, isConnected, updateContent } = useYjsDocument(documentId);
  return {
    content: markdown,
    updateContent,
    lastSynced: isConnected ? new Date() : null,
    isSyncing: false,
  };
}
