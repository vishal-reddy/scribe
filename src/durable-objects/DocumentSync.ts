import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import type { Env } from '../types';

const CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds
const STALE_CONNECTION_MS = 60 * 1000; // 60 seconds

/**
 * DocumentSync Durable Object
 * Manages Y.js CRDT state and WebSocket connections for a single document
 */
export class DocumentSync extends DurableObject<Env> {
  private ydoc: Y.Doc;
  private sessions: Set<WebSocket>;
  private documentId: string;
  private currentEditor: 'user' | 'claude' | null = null;
  private lastPongTimes: Map<WebSocket, number> = new Map();
  private heartbeatInterval: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ydoc = new Y.Doc();
    this.sessions = new Set();
    this.documentId = ctx.id.toString();

    // Load persisted state on initialization
    this.ctx.blockConcurrencyWhile(async () => {
      await this.loadState();
    });
  }

  /**
   * Handle WebSocket connection requests
   */
  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected websocket', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept WebSocket connection
    this.ctx.acceptWebSocket(server);
    this.sessions.add(server);
    this.lastPongTimes.set(server, Date.now());

    // Send current state to new client
    const state = Y.encodeStateAsUpdate(this.ydoc);
    server.send(state);

    // Start heartbeat if this is the first connection
    if (this.sessions.size === 1) {
      this.startHeartbeat();
    }

    // Cancel cleanup alarm since we have active connections
    await this.ctx.storage.deleteAlarm();

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Handle WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    try {
      // Handle pong responses (sent as text "pong")
      if (typeof message === 'string' && message === 'pong') {
        this.lastPongTimes.set(ws, Date.now());
        return;
      }

      const update = new Uint8Array(message as ArrayBuffer);
      
      // Apply update to Y.doc
      Y.applyUpdate(this.ydoc, update);
      
      // Track editor - default to user for WebSocket updates
      this.currentEditor = 'user';
      
      // Broadcast to all other clients
      this.sessions.forEach((session) => {
        if (session !== ws && session.readyState === WebSocket.OPEN) {
          session.send(update);
        }
      });

      // Schedule persistence via alarm (debounced to 30s from now)
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
    } catch (error) {
      console.error('Error processing Y.js update:', error);
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    this.sessions.delete(ws);
    this.lastPongTimes.delete(ws);
    
    // If no more sessions, schedule cleanup alarm
    if (this.sessions.size === 0) {
      this.stopHeartbeat();
      await this.persistState();
      await this.ctx.storage.setAlarm(Date.now() + CLEANUP_DELAY_MS);
    }
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown) {
    console.error('WebSocket error:', error);
    this.sessions.delete(ws);
    this.lastPongTimes.delete(ws);
  }

  /**
   * Alarm handler: persist state and clean up if no clients connected
   */
  async alarm() {
    if (this.sessions.size === 0) {
      // No clients for CLEANUP_DELAY_MS — persist and clean up in-memory state
      await this.persistState();
      this.ydoc.destroy();
      this.ydoc = new Y.Doc();
      this.currentEditor = null;
    } else {
      // Alarm fired while clients are still connected — just persist
      await this.persistState();
    }
  }

  /**
   * Start periodic heartbeat pings to detect stale connections
   */
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const ws of this.sessions) {
        const lastPong = this.lastPongTimes.get(ws) ?? 0;
        if (now - lastPong > STALE_CONNECTION_MS) {
          // Connection is stale — close it
          try {
            ws.close(1011, 'Connection stale');
          } catch {
            // Already closed
          }
          this.sessions.delete(ws);
          this.lastPongTimes.delete(ws);
          continue;
        }
        // Send ping
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        } catch {
          this.sessions.delete(ws);
          this.lastPongTimes.delete(ws);
        }
      }

      // If all connections were cleaned up, schedule cleanup alarm
      if (this.sessions.size === 0) {
        this.stopHeartbeat();
        this.persistState();
        this.ctx.storage.setAlarm(Date.now() + CLEANUP_DELAY_MS);
      }
    }, HEARTBEAT_INTERVAL_MS) as unknown as number;
  }

  /**
   * Stop the heartbeat interval
   */
  private stopHeartbeat() {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Load state from Durable Object storage
   */
  private async loadState() {
    try {
      const stored = await this.ctx.storage.get<Uint8Array>('ydoc-state');
      if (stored) {
        Y.applyUpdate(this.ydoc, stored);
        console.log('Loaded Y.doc state from storage');
      }
    } catch (error) {
      console.error('Error loading state:', error);
    }
  }

  /**
   * Persist state to Durable Object storage
   */
  private async persistState() {
    try {
      const state = Y.encodeStateAsUpdate(this.ydoc);
      await this.ctx.storage.put('ydoc-state', state);
      console.log('Persisted Y.doc state to storage');
    } catch (error) {
      console.error('Error persisting state:', error);
    }
  }

  /**
   * Get current editing status
   */
  async getEditingStatus(): Promise<{ editor: string | null }> {
    return { editor: this.currentEditor };
  }
}
