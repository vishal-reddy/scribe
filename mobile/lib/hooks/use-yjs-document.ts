import { useEffect, useState, useRef } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import apiClient from '../api-client';

const WS_URL = process.env.EXPO_PUBLIC_WS_URL || 'ws://localhost:8787';

export function useYjsDocument(documentId: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [markdown, setMarkdown] = useState('');
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);

  useEffect(() => {
    if (!documentId) return;

    // Create Y.Doc
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    // Create WebSocket provider
    const provider = new WebsocketProvider(
      WS_URL,
      `/api/sync/${documentId}/ws`,
      ydoc
    );
    providerRef.current = provider;

    // Listen for connection status
    provider.on('status', (event: { status: string }) => {
      setIsConnected(event.status === 'connected');
    });

    // Get the text content
    const ytext = ydoc.getText('content');

    // Listen for changes and update markdown
    const updateHandler = () => {
      setMarkdown(ytext.toString());
    };
    
    ytext.observe(updateHandler);

    // Cleanup
    return () => {
      ytext.unobserve(updateHandler);
      provider.destroy();
      ydoc.destroy();
    };
  }, [documentId]);

  const updateContent = (newMarkdown: string) => {
    if (!ydocRef.current) return;
    
    const ytext = ydocRef.current.getText('content');
    
    // Delete all content and insert new
    ydocRef.current.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, newMarkdown);
    });
  };

  return {
    markdown,
    isConnected,
    updateContent,
    ydoc: ydocRef.current,
  };
}

/**
 * Simple Y.js hook without WebSocket (for MVP)
 * Uses polling to sync with backend
 */
export function useSimpleYjsDocument(documentId: string) {
  const [content, setContent] = useState('');
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Poll for updates every 5 seconds
  useEffect(() => {
    if (!documentId) return;

    const fetchDocument = async () => {
      try {
        const response = await apiClient.get(`/api/documents/${documentId}`);
        setContent(response.data.document.markdown || '');
        setLastSynced(new Date());
      } catch (error) {
        console.error('Sync error:', error);
      }
    };

    // Initial fetch
    fetchDocument();

    // Set up polling
    const interval = setInterval(fetchDocument, 5000);

    return () => clearInterval(interval);
  }, [documentId]);

  const updateContent = async (newContent: string) => {
    setContent(newContent);
    setIsSyncing(true);
    
    try {
      await apiClient.patch(`/api/documents/${documentId}`, {
        markdown: newContent,
      });
      setLastSynced(new Date());
    } catch (error) {
      console.error('Update error:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  return {
    content,
    updateContent,
    lastSynced,
    isSyncing,
  };
}
