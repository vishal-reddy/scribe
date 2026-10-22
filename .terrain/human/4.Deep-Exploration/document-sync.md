# Deep Dive: CRDT Document Sync with Durable Objects

Scribe leverages Cloudflare Durable Objects (`DocumentSync`) to provide strong consistency per document.

## In-Memory Synchronization Lifecycle

1. **Hibernatable WebSockets**: Uses `state.acceptWebSocket()` to allow Worker instances to sleep between edits without terminating TCP connections.
2. **Snapshot Consolidation**: Incremental Yjs binary updates are stored in SQLite inside the Durable Object. Periodic checkpoints roll up historical deltas to maintain low memory footprints.
3. **Fallback REST Transport**: For clients unable to maintain persistent WebSockets, `/api/documents/:id` provides etag-based JSON read and write endpoints.
