# Scribe API Quick Reference

> For complete endpoint documentation with full request/response examples, see [API.md](API.md).

Base URL: `https://scribe.<your-domain>.workers.dev` (production) or `http://localhost:8787` (local dev)

All responses use `Content-Type: application/json`.

## Authentication

### Getting a Session Token

Scribe uses passwordless OTP authentication. To obtain a session token:

**1. Request an OTP**

```
POST /api/auth/request-otp
Content-Type: application/json

{ "email": "you@example.com" }
```

Response:

```json
{ "success": true, "message": "Verification code sent to your email", "expiresInSeconds": 300 }
```

**2. Verify the OTP**

```
POST /api/auth/verify-otp
Content-Type: application/json

{ "email": "you@example.com", "otp": "123456" }
```

Response:

```json
{
  "success": true,
  "token": "<session_token>",
  "user": { "id": "...", "email": "you@example.com", "name": "you" },
  "expiresAt": "2025-08-14T00:00:00.000Z"
}
```

**3. Use the token** in all subsequent requests:

```
Authorization: Bearer <session_token>
```

Session tokens are valid for 30 days.

### Alternative Auth Methods

| Method | Header | Use Case |
|--------|--------|----------|
| Session token | `Authorization: Bearer <token>` | Mobile/web app |
| API key | `X-API-Key: <key>` | Admin access |
| Cloudflare Access JWT | `CF-Authorization: <jwt>` | Enterprise SSO |

### Session Info

```
GET /api/auth/session
```

Returns the current user's profile.

### Logout

```
POST /api/auth/logout
```

Invalidates the current session token.

---

## Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/documents` | List all documents |
| `GET` | `/api/documents/:id` | Get a document |
| `POST` | `/api/documents` | Create a document |
| `PATCH` | `/api/documents/:id` | Update a document |
| `DELETE` | `/api/documents/:id` | Delete a document |
| `GET` | `/api/documents/:id/versions` | Version history |
| `POST` | `/api/documents/:id/versions` | Create version snapshot |

### Create Document

```json
POST /api/documents
{ "title": "My Document", "markdown": "# Hello World" }
```

- `title` (required, 1–200 chars)
- `markdown` (optional)

### Update Document

```json
PATCH /api/documents/:id
{ "title": "New Title", "markdown": "# Updated" }
```

All fields optional. Only provided fields are updated.

---

## Claude AI

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/claude/prompt` | Send a prompt to Claude |
| `POST` | `/api/claude/create` | Create a document via Claude |
| `POST` | `/api/claude/edit/:id` | Edit a document via Claude |
| `GET` | `/api/claude/artifacts` | List all artifacts |
| `GET` | `/api/claude/artifacts/:id` | Get a specific artifact |
| `GET` | `/api/claude/history/:documentId` | Claude interaction history |

### Send Prompt

```json
POST /api/claude/prompt
{ "prompt": "Rewrite the intro", "documentId": "uuid" }
```

- `prompt` (required, 1–2000 chars)
- `documentId` (optional — when provided, Claude edits that document)

### Edit Document

```json
POST /api/claude/edit/:id
{ "instruction": "Add a summary at the top" }
```

- `instruction` (required, 1–1000 chars)

---

## MCP (Model Context Protocol)

Connect Claude Desktop or Claude Code to Scribe for direct document access.

### Setup

1. Server URL: `https://scribe.<your-domain>.workers.dev/mcp`
2. Auth header: `Authorization: Bearer <your-mcp-token>`

### Available Tools

| Tool | Description |
|------|-------------|
| `list_documents` | List all documents |
| `read_document` | Read a document by ID |
| `create_document` | Create a new document |
| `update_document` | Update an existing document |
| `search_documents` | Search by title or content |

### Calling Tools

```
POST /mcp/tools/list    — List available tools
POST /mcp/tools/call    — Execute a tool
```

```json
{ "name": "read_document", "arguments": { "documentId": "550e8400-..." } }
```

---

## WebSocket Sync

```
GET /api/sync/:documentId/ws
Headers: Upgrade: websocket
```

Upgrades to a WebSocket for real-time Y.js CRDT collaboration. All messages are binary Y.js updates (`Uint8Array`).

---

## Error Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [{ "path": "title", "message": "Required" }],
    "requestId": "...",
    "timestamp": "..."
  }
}
```

| Code | Status | Description |
|------|--------|-------------|
| `VALIDATION_ERROR` | 400 | Request body failed Zod validation |
| `UNAUTHORIZED` | 401 | Missing or invalid auth token |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Claude AI operations | 10 requests/minute |
| Document operations | 60 requests/minute |
| General API | 120 requests/minute |

Exceeding limits returns `429 Too Many Requests`.
