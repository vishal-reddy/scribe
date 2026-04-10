import React, { useRef, useState, useCallback, useEffect, useImperativeHandle } from 'react';
import { View, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';

interface BlockNoteEditorProps {
  initialContent?: string;
  onContentChange?: (markdown: string, blocks: any) => void;
  editable?: boolean;
  ydoc?: any;
}

export interface BlockNoteEditorRef {
  getContent: () => Promise<{ markdown: string; blocks: any }>;
  exportMarkdown: () => Promise<string>;
}

const BlockNoteEditor = React.forwardRef<BlockNoteEditorRef, BlockNoteEditorProps>(({
  initialContent,
  onContentChange,
  editable = true,
  ydoc,
}, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [isReady, setIsReady] = useState(false);
  const [htmlUri, setHtmlUri] = useState<string>('');
  const contentPromiseRef = useRef<{ resolve: (value: any) => void } | null>(null);

  // Load the HTML asset
  useEffect(() => {
    const loadAsset = async () => {
      try {
        // For web, use direct path
        if (Platform.OS === 'web') {
          setHtmlUri('/assets/blocknote-editor.html');
        } else {
          // For mobile, load asset
          const asset = Asset.fromModule(require('../assets/blocknote-editor.html'));
          await asset.downloadAsync();
          setHtmlUri(asset.localUri || asset.uri);
        }
      } catch (error) {
        console.error('Error loading BlockNote HTML:', error);
      }
    };
    loadAsset();
  }, []);

  const handleMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      if (data.type === 'ready') {
        setIsReady(true);
        if (initialContent) {
          webViewRef.current?.postMessage(JSON.stringify({
            type: 'init',
            content: initialContent,
          }));
        }
      } else if (data.type === 'contentChange') {
        onContentChange?.(data.markdown, data.blocks);
        
        // Sync with Y.js if available
        if (ydoc) {
          const ytext = ydoc.getText('content');
          ydoc.transact(() => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, data.markdown);
          });
        }
      } else if (data.type === 'content') {
        // Resolve pending getContent promise
        if (contentPromiseRef.current) {
          contentPromiseRef.current.resolve({
            markdown: data.markdown,
            blocks: data.blocks,
          });
          contentPromiseRef.current = null;
        }
      }
    } catch (error) {
      console.error('Error handling WebView message:', error);
    }
  }, [initialContent, onContentChange, ydoc]);

  // Sync Y.js changes to editor
  useEffect(() => {
    if (!ydoc || !isReady) return;

    const ytext = ydoc.getText('content');
    
    const updateHandler = () => {
      const markdown = ytext.toString();
      webViewRef.current?.postMessage(JSON.stringify({
        type: 'setContent',
        content: markdown,
      }));
    };
    
    ytext.observe(updateHandler);
    
    return () => {
      ytext.unobserve(updateHandler);
    };
  }, [ydoc, isReady]);

  const getContent = useCallback((): Promise<{ markdown: string; blocks: any }> => {
    return new Promise((resolve) => {
      contentPromiseRef.current = { resolve };
      webViewRef.current?.postMessage(JSON.stringify({ type: 'getContent' }));
      
      // Timeout after 5 seconds
      setTimeout(() => {
        if (contentPromiseRef.current) {
          contentPromiseRef.current.resolve({ markdown: '', blocks: [] });
          contentPromiseRef.current = null;
        }
      }, 5000);
    });
  }, []);

  const exportMarkdown = useCallback(async (): Promise<string> => {
    const { markdown } = await getContent();
    return markdown;
  }, [getContent]);

  useImperativeHandle(ref, () => ({
    getContent,
    exportMarkdown,
  }));

  if (!htmlUri) {
    return <View className="flex-1" />;
  }

  return (
    <View className="flex-1">
      <WebView
        ref={webViewRef}
        source={{ uri: htmlUri }}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled
        nestedScrollEnabled
        originWhitelist={['*']}
      />
    </View>
  );
});

BlockNoteEditor.displayName = 'BlockNoteEditor';

export default BlockNoteEditor;
