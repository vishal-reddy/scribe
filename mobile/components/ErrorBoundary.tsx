import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  level?: 'root' | 'screen';
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary Component
 * Catches JavaScript errors in child components and displays fallback UI
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { onError, level = 'screen' } = this.props;

    console.error('ErrorBoundary caught error:', {
      level,
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    onError?.(error, errorInfo);
    this.reportError(error, errorInfo);
    this.setState({ errorInfo });
  }

  async reportError(error: Error, errorInfo: ErrorInfo) {
    try {
      console.log('Reporting error to backend:', {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
      });
    } catch (err) {
      console.error('Failed to report error:', err);
    }
  }

  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    const { hasError, error } = this.state;
    const { children, fallback, level = 'screen' } = this.props;

    if (hasError && error) {
      if (fallback) {
        return fallback(error, this.resetError);
      }

      const isRoot = level === 'root';

      return (
        <View style={styles.container}>
          <View style={styles.card}>
            {/* Icon */}
            <View style={styles.iconWrapper}>
              <Text style={styles.iconText}>⚠️</Text>
            </View>

            {/* Title */}
            <Text style={styles.title}>
              {isRoot ? 'Something went wrong' : 'Error loading content'}
            </Text>

            {/* Description */}
            <Text style={styles.description}>
              {isRoot
                ? 'The app encountered an unexpected error. Please try restarting.'
                : 'This content failed to load. You can try again or go back.'}
            </Text>

            {/* Dev-only error details */}
            {__DEV__ && (
              <ScrollView style={styles.devDetails}>
                <Text style={styles.devText}>{error.message}</Text>
                {error.stack ? (
                  <Text style={styles.devStack}>{error.stack}</Text>
                ) : null}
              </ScrollView>
            )}

            {/* Actions */}
            <TouchableOpacity onPress={this.resetError} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Try Again</Text>
            </TouchableOpacity>

            {isRoot && (
              <TouchableOpacity
                onPress={this.resetError}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Restart App</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      );
    }

    return children;
  }
}

/**
 * Root Error Boundary — for catastrophic failures
 */
export function RootErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      level="root"
      onError={(error, errorInfo) => {
        console.error('Root error boundary triggered:', error, errorInfo);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * Screen Error Boundary — for individual screen errors
 */
export function ScreenErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      level="screen"
      onError={(error, errorInfo) => {
        console.warn('Screen error boundary triggered:', error, errorInfo);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const BURGUNDY = '#971B2F';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#F9FAFB',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    ...Platform.select({
      web: { boxShadow: '0 4px 24px rgba(0,0,0,0.10)' },
      default: { elevation: 6 },
    }),
  },
  iconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(151,27,47,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconText: {
    fontSize: 28,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  devDetails: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    maxHeight: 120,
    width: '100%',
  },
  devText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#374151',
  },
  devStack: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#9CA3AF',
    marginTop: 6,
  },
  primaryButton: {
    backgroundColor: BURGUNDY,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
    marginBottom: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: '#E5E7EB',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
  },
  secondaryButtonText: {
    color: '#374151',
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 15,
  },
});
