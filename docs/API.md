# Scribe API Reference

Base URL: `https://scribe.<your-domain>.workers.dev` (production) or `http://localhost:8787` (local dev)

All responses use `Content-Type: application/json`.

---

## Table of Contents

- [Authentication](#authentication)
- [Error Responses](#error-responses)
- [Health](#health)
- [Auth](#auth)
- [Documents](#documents)
- [Claude AI](#claude-ai)
- [MCP (Model Context Protocol)](#mcp-model-context-protocol)
- [Sync (WebSocket)](#sync-websocket)

---

## Authentication

Protected routes (`/api/*`) require a JWT token via one of:

| Header | Format |
|--------|--------|
| `CF-Authorization` | `<jwt>` (Cloudflare Access) |
| `Authorization` | `Bearer <jwt>` |

The JWT payload must include an `email` claim. Optionally it can include a `name` claim.

**Unprotected routes:** `GET /`, `GET /health`, `GET /ready`

---

## Error Responses

All errors follow a consistent structure:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "path": "title", "message": "Required" }
    ],
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2025-01-15T10:30:00.000Z"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request body failed Zod schema validation |
| `INVALID_REQUEST` | 400 | Malformed request |
| `UNAUTHORIZED` | 401 | Missing or invalid auth token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `TOKEN_EXPIRED` | 401 | JWT token has expired |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource conflict |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `DATABASE_ERROR` | 500 | D1 database error |
| `EXTERNAL_SERVICE_ERROR` | 500 | Anthropic API or other external failure |

---

## Health

### GET /health

Basic health check. No authentication required.

**Response `200 OK`:**

```json
{
  "status": "ok",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "service": "scribe",
  "version": "1.0.0"
}
```

---

### GET /ready

Readiness check that verifies D1 database and Durable Objects bindings. No authentication required.

**Response `200 OK`:**

```json
{
  "status": "ready",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "checks": {
    "database": true,
    "durableObjects": true
  }
}
```

**Response `503 Service Unavailable`:**

```json
{
  "status": "not ready",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "checks": {
    "database": false,
    "durableObjects": true
  }
}
```

---

## Auth

### GET /api/user

Returns the authenticated user's profile derived from the JWT token.

**Authentication:** Required

**Response `200 OK`:**

```json
{
  "userId": "dXNlckBleGFtcGxlLmNvbQ",
  "email": "user@example.com",
  "name": "Jane Doe"
}
```

**Response `401 Unauthorized`:**

```json
{ "error": "Unauthorized: No token provided" }
```

---

## Documents

### GET /api/documents

List all documents, ordered by most recently updated.

**Authentication:** Required

**Response `200 OK`:**

```json
{
  "documents": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "My Document",
      "markdown": "# Hello World\n\nThis is my document.",
      "createdAt": "2025-01-15T10:00:00.000Z",
      "updatedAt": "2025-01-15T10:30:00.000Z",
      "createdBy": "user",
      "lastEditedBy": "claude"
    }
  ]
}
```

**Response `500 Internal Server Error`:**

```json
{ "error": "Failed to fetch documents" }
```

---

### GET /api/documents/:id

Get a specific document by ID, including the full Y.js content state.

**Authentication:** Required

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Document ID |

**Response `200 OK`:**

```json
{
  "document": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "My Document",
    "content": "<base64-encoded Y.js state>",
    "markdown": "# Hello World\n\nThis is my document.",
    "createdAt": "2025-01-15T10:00:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z",
    "createdBy": "user",
    "lastEditedBy": "user"
  }
}
```

**Response `404 Not Found`:**

```json
{ "error": "Document not found" }
```

---

### POST /api/documents

Create a new document.

**Authentication:** Required

**Request Body:**

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `title` | string | Yes | 1–200 chars | Document title |
| `markdown` | string | No | — | Initial markdown content (defaults to `""`) |

```json
{
  "title": "My New Document",
  "markdown": "# Getting Started\n\nWrite here..."
}
```

**Response `201 Created`:**

```json
{
  "document": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "My New Document",
    "content": "",
    "markdown": "# Getting Started\n\nWrite here...",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z",
    "createdBy": "user",
    "lastEditedBy": "user"
  }
}
```

**Response `400 Bad Request`:** Zod validation error (see [Error Responses](#error-responses))

---

### PATCH /api/documents/:id

Update an existing document. Only provided fields are updated.

**Authentication:** Required

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Document ID |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `title` | string | No | 1–200 chars | New title |
| `content` | string | No | — | Y.js CRDT state (base64) |
| `markdown` | string | No | — | Updated markdown |

```json
{
  "title": "Updated Title",
  "markdown": "# Updated Content"
}
```

**Response `200 OK`:**

```json
{
  "document": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Updated Title",
    "content": "",
    "markdown": "# Updated Content",
    "createdAt": "2025-01-15T10:00:00.000Z",
    "updatedAt": "2025-01-15T10:35:00.000Z",
    "createdBy": "user",
    "lastEditedBy": "user"
  }
}
```

**Response `404 Not Found`:**

```json
{ "error": "Document not found" }
```

---

### DELETE /api/documents/:id

Delete a document and all associated version snapshots (cascade).

**Authentication:** Required

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Document ID |

**Response `200 OK`:**

```json
{ "success": true, "message": "Document deleted" }
```

**Response `404 Not Found`:**

```json
{ "error": "Document not found" }
```

---

### GET /api/documents/:id/versions

Get the version history for a document, ordered newest first.

**Authentication:** Required

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Document ID |

**Response `200 OK`:**

```json
{
  "versions": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440000",
      "documentId": "550e8400-e29b-41d4-a716-446655440000",
      "version": 3,
      "content": "<base64-encoded Y.js state snapshot>",
      "markdown": "# Version 3 content...",
      "createdAt": "2025-01-15T10:30:00.000Z",
      "createdBy": "user"
    },
    {
      "id": "770e8400-e29b-41d4-a716-446655440000",
      "documentId": "550e8400-e29b-41d4-a716-446655440000",
      "version": 2,
      "content": "<base64-encoded Y.js state snapshot>",
      "markdown": "# Version 2 content...",
      "createdAt": "2025-01-15T09:00:00.000Z",
      "createdBy": "claude"
    }
  ]
}
```

---

### POST /api/documents/:id/versions

Create a point-in-time version snapshot of the current document state.

**Authentication:** Required

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Document ID |

**Request Body:** None

**Response `201 Created`:**

```json
{
  "version": {
    "id": "880e8400-e29b-41d4-a716-446655440000",
    "documentId": "550e8400-e29b-41d4-a716-446655440000",
    "version": 4,
    "content": "<base64-encoded Y.js state snapshot>",
    "markdown": "# Current content at snapshot time...",
    "createdAt": "2025-01-15T10:35:00.000Z",
    "createdBy": "user"
  }
}
```

**Response `404 Not Found`:**

```json
{ "error": "Document not found" }
```

---

## Claude AI

### POST /api/claude/prompt

Send a natural-language prompt to Claude. If a `documentId` is provided, Claude receives the document content as context and the document is updated with Claude's response.

**Authentication:** Required

**Request Body:**

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `prompt` | string | Yes | 1–2000 chars | Natural language instruction |
| `documentId` | string | No | UUID | Target document for contextual editing |

```json
{
  "prompt": "Rewrite the introduction to be more engaging",
  "documentId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response `200 OK`:**

```json
{
  "response": "# A Bold New Beginning\n\nWelcome to a world where...",
  "documentId": "550e8400-e29b-41d4-a716-446655440000",
  "interactionId": "990e8400-e29b-41d4-a716-446655440000"
}
```

When `documentId` is provided, the document's `markdown` is overwritten with Claude's response and a notification is stored. The `interactionId` can be used to look up the interaction in the audit log.

**Response `500 Internal Server Error`:**

```json
{
  "error": "Failed to process prompt",
  "details": "Anthropic API rate limit exceeded"
}
```

---

### GET /api/claude/artifacts

List all documents formatted as Claude artifacts, ordered by most recently updated.

**Authentication:** Required

**Response `200 OK`:**

```json
{
  "artifacts": [
    {
      "artifactId": "550e8400-e29b-41d4-a716-446655440000",
      "title": "My Document",
      "content": "# Hello World\n\nThis is my document.",
      "createdAt": "2025-01-15T10:00:00.000Z",
      "updatedAt": "2025-01-15T10:30:00.000Z",
      "author": "user",
      "lastEditor": "claude"
    }
  ],
  "count": 1
}
```

---

### GET /api/claude/artifacts/:id

Get a specific document as a Claude artifact.

**Authentication:** Required

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Artifact (document) ID |

**Response `200 OK`:**

```json
{
  "artifact": {
    "artifactId": "550e8400-e29b-41d4-a716-446655440000",
    "title": "My Document",
    "content": "# Hello World\n\nThis is my document.",
    "createdAt": "2025-01-15T10:00:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z",
    "author": "user",
    "lastEditor": "claude"
  }
}
```

**Response `404 Not Found`:**

```json
{ "error": "Artifact not found" }
```

---

### POST /api/claude/create

Create a new document authored by Claude.

**Authentication:** Required

**Request Body:**

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `title` | string | Yes | 1–200 chars | Document title |
| `content` | string | Yes | — | Markdown content |

```json
{
  "title": "Meeting Notes — January 15",
  "content": "# Meeting Notes\n\n## Attendees\n- Alice\n- Bob"
}
```

**Response `201 Created`:**

```json
{
  "artifact": {
    "artifactId": "aa0e8400-e29b-41d4-a716-446655440000",
    "title": "Meeting Notes — January 15",
    "content": "# Meeting Notes\n\n## Attendees\n- Alice\n- Bob",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z"
  }
}
```

The creation is also logged in the Claude interactions audit table with `operation: "create"`.

---

### POST /api/claude/edit/:id

Edit an existing document using Claude. Sends the current document content plus your instruction to Claude and replaces the document with Claude's edited version.

**Authentication:** Required

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Document ID to edit |

**Request Body:**

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `instruction` | string | Yes | 1–1000 chars | Editing instruction for Claude |

```json
{
  "instruction": "Add a summary section at the top and fix any typos"
}
```

**Response `200 OK`:**

```json
{
  "artifact": {
    "artifactId": "550e8400-e29b-41d4-a716-446655440000",
    "title": "My Document",
    "content": "## Summary\n\nThis document covers...\n\n# Hello World\n\nThis is my document.",
    "updatedAt": "2025-01-15T10:35:00.000Z"
  }
}
```

**Response `404 Not Found`:**

```json
{ "error": "Artifact not found" }
```

**Response `500 Internal Server Error`:**

```json
{
  "error": "Failed to edit artifact",
  "details": "Anthropic API error message"
}
```

---

### GET /api/claude/history/:documentId

Get Claude's interaction history for a document, ordered newest first. Response text is truncated to a 200-character preview.

**Authentication:** Required

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `documentId` | string (UUID) | Document ID |

**Response `200 OK`:**

```json
{
  "documentId": "550e8400-e29b-41d4-a716-446655440000",
  "history": [
    {
      "id": "bb0e8400-e29b-41d4-a716-446655440000",
      "prompt": "Add a summary section at the top",
      "operation": "edit",
      "createdAt": "2025-01-15T10:35:00.000Z",
      "preview": "## Summary\n\nThis document covers the key topics discussed in the January meeting including budget allo..."
    },
    {
      "id": "cc0e8400-e29b-41d4-a716-446655440000",
      "prompt": "Create document: Meeting Notes — January 15",
      "operation": "create",
      "createdAt": "2025-01-15T10:30:00.000Z",
      "preview": "# Meeting Notes\n\n## Attendees\n- Alice\n- Bob\n\n## Agenda\n1. Budget review\n2. Project timelines\n3. Tea..."
    }
  ]
}
```

---

## MCP (Model Context Protocol)

The MCP endpoints implement a subset of the [Model Context Protocol](https://modelcontextprotocol.io/) specification, enabling Claude and other AI assistants to interact with Scribe documents as tools.

### POST /mcp/tools/list

List the available MCP tools.

**Authentication:** Required

**Request Body:** None (or empty object)

**Response `200 OK`:**

```json
{
  "tools": [
    {
      "name": "list_documents",
      "description": "List all user documents in Scribe",
      "inputSchema": { "type": "object", "properties": {} }
    },
    {
      "name": "read_document",
      "description": "Read the content of a specific document",
      "inputSchema": {
        "type": "object",
        "properties": {
          "documentId": { "type": "string", "description": "The ID of the document to read" }
        },
        "required": ["documentId"]
      }
    },
    {
      "name": "create_document",
      "description": "Create a new document in Scribe",
      "inputSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string", "description": "The title of the new document" },
          "content": { "type": "string", "description": "The markdown content of the document" }
        },
        "required": ["title", "content"]
      }
    },
    {
      "name": "update_document",
      "description": "Update an existing document",
      "inputSchema": {
        "type": "object",
        "properties": {
          "documentId": { "type": "string", "description": "The ID of the document to update" },
          "title": { "type": "string", "description": "New title (optional)" },
          "content": { "type": "string", "description": "New markdown content (optional)" }
        },
        "required": ["documentId"]
      }
    },
    {
      "name": "search_documents",
      "description": "Search documents by title or content",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Search query" }
        },
        "required": ["query"]
      }
    }
  ]
}
```

---

### POST /mcp/tools/call

Execute an MCP tool.

**Authentication:** Required

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Tool name (see list above) |
| `arguments` | object | Yes | Tool-specific arguments matching the `inputSchema` |

#### Example: `list_documents`

```json
{ "name": "list_documents", "arguments": {} }
```

**Response `200 OK`:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "[\n  {\n    \"id\": \"550e8400-...\",\n    \"title\": \"My Document\",\n    \"createdAt\": \"2025-01-15T10:00:00.000Z\",\n    \"updatedAt\": \"2025-01-15T10:30:00.000Z\",\n    \"lastEditedBy\": \"user\"\n  }\n]"
    }
  ]
}
```

#### Example: `read_document`

```json
{ "name": "read_document", "arguments": { "documentId": "550e8400-..." } }
```

**Response `200 OK`:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Title: My Document\n\nContent:\n# Hello World\n\nThis is my document."
    }
  ]
}
```

#### Example: `create_document`

```json
{
  "name": "create_document",
  "arguments": { "title": "New Doc", "content": "# Hello" }
}
```

**Response `200 OK`:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Document created successfully!\nID: 550e8400-...\nTitle: New Doc"
    }
  ]
}
```

#### Example: `update_document`

```json
{
  "name": "update_document",
  "arguments": { "documentId": "550e8400-...", "content": "# Updated" }
}
```

**Response `200 OK`:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Document updated successfully!\nID: 550e8400-..."
    }
  ]
}
```

#### Example: `search_documents`

```json
{ "name": "search_documents", "arguments": { "query": "meeting notes" } }
```

**Response `200 OK`:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Found 2 documents:\n\n[\n  {\n    \"id\": \"550e8400-...\",\n    \"title\": \"Meeting Notes\",\n    \"preview\": \"# Meeting Notes\\n\\n## Attendees...\"\n  }\n]"
    }
  ]
}
```

#### Error Response (unknown tool):

```json
{
  "content": [
    { "type": "text", "text": "Error: Unknown tool 'bad_tool'" }
  ],
  "isError": true
}
```

#### Error Response (not found):

```json
{
  "content": [
    { "type": "text", "text": "Error: Document with ID abc-123 not found" }
  ],
  "isError": true
}
```

---

## Sync (WebSocket)

### GET /api/sync/:documentId/ws

Upgrade to a WebSocket connection for real-time document collaboration using Y.js CRDT synchronization.

**Authentication:** Required (via `/api/*` middleware)

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `documentId` | string (UUID) | Document ID to synchronize |

**Headers Required:**

```
Upgrade: websocket
Connection: Upgrade
```

**WebSocket Protocol:**

1. **Connection**: Client sends HTTP upgrade request. Server returns `101 Switching Protocols`.
2. **Initial state**: Server immediately sends the current Y.js document state as a binary `Uint8Array`.
3. **Client updates**: Client sends Y.js updates as binary `ArrayBuffer` messages.
4. **Server broadcast**: Server applies the update to the shared Y.Doc and broadcasts it to all other connected clients.
5. **Persistence**: Document state is persisted to Durable Object storage every 30 seconds while there are active connections.
6. **Disconnect**: When the last client disconnects, state is persisted immediately and the Durable Object idles.

**Message format:** All messages are binary Y.js updates (`Uint8Array`). No JSON framing is used.

**Error:**

If the request is not a WebSocket upgrade:

```
HTTP 400: "Expected websocket"
```

**Example (JavaScript client):**

```javascript
const ws = new WebSocket('wss://scribe.example.com/api/sync/DOC_ID/ws');
ws.binaryType = 'arraybuffer';

ws.onmessage = (event) => {
  const update = new Uint8Array(event.data);
  Y.applyUpdate(localYDoc, update);
};

// Send local changes
localYDoc.on('update', (update) => {
  ws.send(update);
});
```
