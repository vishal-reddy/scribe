# Scribe Architecture

This document describes the system design, component responsibilities, data flows, and technology rationale for Scribe.

---

## Table of Contents

- [High-Level Overview](#high-level-overview)
- [Component Breakdown](#component-breakdown)
- [Data Flow Diagrams](#data-flow-diagrams)
- [Database Schema](#database-schema)
- [Security Model](#security-model)
- [Technology Choices and Rationale](#technology-choices-and-rationale)

---

## High-Level Overview

Scribe is a collaborative markdown editor where users and Claude AI co-author documents in real time. The system is built on Cloudflare's edge platform to minimize latency worldwide.

```
┌──────────────────────────────────────────────────────────────────┐
│                          Clients                                  │
│                                                                    │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐   │
│   │  iOS App    │   │ Android App │   │   Web App           │   │
│   │  (Expo)     │   │  (Expo)     │   │   (Expo for Web)    │   │
│   └──────┬──────┘   └──────┬──────┘   └──────────┬──────────┘   │
│          │                 │                      │               │
│          │    Y.js CRDT    │   React Query        │               │
│          │    Client       │   + Zustand          │               │
└──────────┼─────────────────┼──────────────────────┼───────────────┘
           │                 │                      │
           │    HTTPS / WSS  │                      │
           ▼                 ▼                      ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Cloudflare Workers (Edge)                         │
│                                                                    │
│   ┌────────────────────────────────────────────────────────────┐ │
│   │                     Hono API Server                        │ │
│   │                                                            │ │
│   │  Middleware Pipeline:                                      │ │
│   │  structuredLogger → cors → secureHeaders → authMiddleware  │ │
│   │                                                            │ │
│   │  ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐ │ │
│   │  │ /api/      │ │ /api/      │ │ /api/    │ │ /mcp/    │ │ │
│   │  │ documents  │ │ claude     │ │ sync     │ │ tools    │ │ │
│   │  └─────┬──────┘ └─────┬──────┘ └────┬─────┘ └────┬─────┘ │ │
│   └────────┼──────────────┼─────────────┼─────────────┼────────┘ │
│            │              │             │             │           │
│            ▼              ▼             ▼             ▼           │
│   ┌──────────────┐ ┌──────────┐ ┌────────────────┐              │
│   │ Cloudflare   │ │ Anthropic│ │ Durable Object │              │
│   │ D1 (SQLite)  │ │ Claude   │ │ DocumentSync   │              │
│   │              │ │ API      │ │ (Y.js + WS)    │              │
│   └──────────────┘ └──────────┘ └────────────────┘              │
└──────────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Edge-first** — Every request is handled at the Cloudflare edge closest to the user.
2. **Serverless** — No servers to manage; auto-scales from zero to global.
3. **CRDT-based collaboration** — Y.js provides conflict-free merging without a central coordination server.
4. **AI as a collaborator** — Claude is treated as a first-class editor alongside human users.
5. **Audit everything** — All Claude interactions are logged for transparency and reproducibility.

---

## Component Breakdown

### 1. Hono API Server (`src/index.ts`)

The main entry point. A lightweight [Hono](https://hono.dev/) application that registers middleware and routes:

| Layer | Purpose |
|-------|---------|
| `structuredLogger` | JSON-structured request/response logging with timing metrics |
| `cors()` | Cross-origin resource sharing for mobile/web clients |
| `secureHeaders()` | Security headers (X-Content-Type-Options, X-Frame-Options, etc.) |
| `authMiddleware` | JWT validation on `/api/*` routes |
| `errorHandler` | Global error handler with consistent error response format |

Routes are organized as Hono sub-applications mounted at their respective paths.

### 2. Cloudflare D1 Database

A serverless SQLite database at the edge. Accessed via [Drizzle ORM](https://orm.drizzle.team/) for type-safe queries. Stores:

- **Documents** — title, Y.js CRDT state, cached markdown, authorship metadata
- **Document versions** — point-in-time snapshots linked to a document
- **Claude interactions** — audit log of every AI prompt and response

See [Database Schema](#database-schema) for full details.

### 3. Durable Objects — `DocumentSync`

Each document gets its own `DocumentSync` Durable Object instance (keyed by document ID). Responsibilities:

| Feature | Implementation |
|---------|----------------|
| WebSocket management | Accepts upgrades, tracks active sessions |
| Y.js state coordination | Maintains an in-memory `Y.Doc`, applies and broadcasts updates |
| Persistence | Stores Y.js state in Durable Object storage, debounced every 30 seconds |
| Cleanup | Persists immediately when the last client disconnects |

The Durable Object guarantees single-threaded access, so there are no race conditions when applying concurrent updates.

### 4. Claude AI Integration (`src/routes/claude.ts`)

Three modes of interaction with Claude:

| Mode | Endpoint | Description |
|------|----------|-------------|
| **Prompt** | `POST /api/claude/prompt` | Free-form natural language; optionally targets a document |
| **Create** | `POST /api/claude/create` | Claude generates a new document from a title and content |
| **Edit** | `POST /api/claude/edit/:id` | Claude receives existing content + instruction, returns edited version |

All interactions use the `claude-3-5-sonnet-20241022` model with a 4096 token limit. Every call is logged to the `claude_interactions` table.

### 5. MCP Server (`src/routes/mcp.ts`)

Implements the [Model Context Protocol](https://modelcontextprotocol.io/) tool-use pattern. Exposes five tools:

- `list_documents` — enumerate all documents
- `read_document` — fetch a document's content
- `create_document` — create a new document
- `update_document` — modify an existing document
- `search_documents` — full-text search (SQL `LIKE`)

MCP responses follow the `{ content: [{ type: "text", text: "..." }] }` format with an `isError` flag for failures.

### 6. Middleware Stack

| Middleware | File | Purpose |
|------------|------|---------|
| `structuredLogger` | `src/middleware/logger.ts` | JSON logging, request timing, Cloudflare Analytics integration |
| `authMiddleware` | `src/middleware/auth.ts` | JWT parsing from CF-Authorization or Bearer token, user extraction |
| `errorHandler` | `src/middleware/error-handler.ts` | Zod validation errors, AppError, HTTPException, unexpected errors |

### 7. Frontend — Expo/React Native (`mobile/`)

Cross-platform mobile and web application:

- **Expo Router** for file-based navigation
- **NativeWind** (Tailwind CSS) for styling
- **React Query** for API data fetching and caching
- **Zustand** for client-side state management
- **Y.js client** for CRDT synchronization over WebSocket

---

## Data Flow Diagrams

### Document Editing (Real-time Sync)

```
  Client A                Durable Object              Client B
     │                    (DocumentSync)                  │
     │                         │                          │
     │── WS Upgrade ──────────▶│                          │
     │◀── 101 + Y.js state ───│                          │
     │                         │◀── WS Upgrade ───────────│
     │                         │── Y.js state ───────────▶│
     │                         │                          │
     │── Y.js update ────────▶│                          │
     │                         │── apply to Y.Doc         │
     │                         │── broadcast ────────────▶│
     │                         │                          │
     │                         │◀── Y.js update ──────────│
     │◀── broadcast ───────────│── apply to Y.Doc         │
     │                         │                          │
     │                    [30s debounce]                   │
     │                         │── persist to DO storage   │
     │                         │                          │
```

### Claude Prompt Processing

```
  Client                  Hono Worker               Anthropic API
     │                         │                          │
     │── POST /api/claude/    │                          │
     │   prompt               │                          │
     │   { prompt, docId }    │                          │
     │                         │── SELECT document ──▶ D1  │
     │                         │◀── document data ────────│
     │                         │                          │
     │                         │── messages.create() ────▶│
     │                         │   (system + doc context)  │
     │                         │◀── response text ────────│
     │                         │                          │
     │                         │── UPDATE document ──▶ D1  │
     │                         │── INSERT interaction ▶ D1 │
     │                         │── store notification      │
     │                         │                          │
     │◀── { response,         │                          │
     │      documentId,       │                          │
     │      interactionId }   │                          │
```

### WebSocket Connection Lifecycle

```
  Client                   Worker                  Durable Object
     │                       │                          │
     │── GET /api/sync/     │                          │
     │   :docId/ws          │                          │
     │   Upgrade: websocket │                          │
     │                       │── idFromName(docId) ────▶│
     │                       │── stub.fetch(req) ──────▶│
     │                       │                          │── acceptWebSocket()
     │                       │                          │── loadState()
     │◀── 101 Switching ────│◀──────────────────────────│
     │◀── initial Y.js ─────│◀──────────────────────────│
     │     state (binary)    │                          │
     │                       │                          │
     │── binary updates ────│──────────────────────────▶│
     │                       │                          │── applyUpdate()
     │◀── broadcast ────────│◀──────────────────────────│── broadcast to others
     │                       │                          │
     │── WS close ──────────│──────────────────────────▶│
     │                       │                          │── sessions.delete()
     │                       │                          │── if last: persistState()
```

---

## Database Schema

Managed by Drizzle ORM. Defined in `src/db/schema.ts`, migrations in `src/db/migrations/`.

### `documents`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `title` | TEXT NOT NULL | Document title |
| `content` | TEXT NOT NULL | Base64-encoded Y.js CRDT state |
| `markdown` | TEXT NOT NULL | Cached markdown export (for reads without CRDT decoding) |
| `created_at` | INTEGER (timestamp) | Creation time |
| `updated_at` | INTEGER (timestamp) | Last modification time |
| `created_by` | TEXT NOT NULL | `"user"` or `"claude"` |
| `last_edited_by` | TEXT NOT NULL | `"user"` or `"claude"` |

### `document_versions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `document_id` | TEXT FK → documents.id | Parent document (CASCADE delete) |
| `version` | INTEGER NOT NULL | Auto-incrementing version number |
| `content` | TEXT NOT NULL | Y.js CRDT state snapshot |
| `markdown` | TEXT NOT NULL | Markdown at snapshot time |
| `created_at` | INTEGER (timestamp) | Snapshot creation time |
| `created_by` | TEXT NOT NULL | `"user"` or `"claude"` |

### `claude_interactions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `document_id` | TEXT FK → documents.id | Related document (SET NULL on delete) |
| `prompt` | TEXT NOT NULL | User's original prompt |
| `response` | TEXT NOT NULL | Claude's full response |
| `operation` | TEXT NOT NULL | `"create"`, `"edit"`, or `"read"` |
| `created_at` | INTEGER (timestamp) | Interaction time |

### Entity Relationship

```
  documents ──────< document_versions
      │                 (1:N, CASCADE)
      │
      └────────< claude_interactions
                     (1:N, SET NULL)
```

---

## Security Model

### Authentication Flow

```
  Client                Cloudflare Access           Scribe Worker
     │                       │                          │
     │── Login ─────────────▶│                          │
     │◀── JWT (CF-Access) ───│                          │
     │                       │                          │
     │── Request + JWT ─────────────────────────────────▶│
     │                       │                  authMiddleware:
     │                       │                  1. Extract JWT from
     │                       │                     CF-Authorization
     │                       │                     or Authorization
     │                       │                  2. Decode & validate
     │                       │                  3. Extract email claim
     │                       │                  4. Hash email → userId
     │                       │                  5. Set context vars
     │◀── Response ──────────────────────────────────────│
```

Scribe supports two token delivery methods:
- **`CF-Authorization`** header — set automatically by Cloudflare Access
- **`Authorization: Bearer <jwt>`** header — for direct API access

### CORS

CORS is enabled globally via Hono's `cors()` middleware with default settings (all origins allowed). In production, this should be restricted to the app's domain.

### Secure Headers

The `secureHeaders()` middleware adds:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `X-XSS-Protection: 1; mode=block`

### Request Tracing

Every request is assigned a UUID (`requestId`) by the structured logger. This ID is included in all log entries and error responses for end-to-end tracing.

### Secrets Management

| Secret | Storage | Usage |
|--------|---------|-------|
| `ANTHROPIC_API_KEY` | Wrangler secret (encrypted at rest) | Claude API authentication |
| `CF_ACCESS_TEAM_DOMAIN` | Environment variable | Cloudflare Access JWT validation |
| `CF_ACCESS_AUDIENCE` | Environment variable | Cloudflare Access audience tag |
| `SENTRY_DSN` | Environment variable (optional) | Error reporting |

Secrets are never logged or included in API responses.

---

## Technology Choices and Rationale

| Technology | Choice | Rationale |
|------------|--------|-----------|
| **Runtime** | Cloudflare Workers | Sub-millisecond cold starts, global edge deployment, built-in D1/DO/R2 bindings. No container or VM overhead. |
| **Framework** | Hono | Purpose-built for Workers/edge runtimes. Tiny bundle size (~14 KB), middleware-based, full TypeScript support. |
| **Database** | Cloudflare D1 (SQLite) | Colocated with Workers at the edge. Zero-config, automatic replication. Drizzle ORM provides type-safe access. |
| **Real-time** | Durable Objects + Y.js | Durable Objects provide single-threaded, stateful WebSocket coordination — exactly what CRDT sync needs. No external pub/sub required. |
| **CRDT** | Y.js | Industry-standard CRDT library for collaborative editing. Supports rich text, handles offline/merge gracefully. |
| **AI** | Anthropic Claude (Sonnet) | Strong instruction-following for document editing. Long context window for large documents. |
| **Validation** | Zod | Runtime schema validation with TypeScript type inference. Integrates with Hono via `@hono/zod-validator`. |
| **ORM** | Drizzle | Lightweight, SQL-centric ORM that generates optimal queries. Works well with D1's SQLite dialect. |
| **Frontend** | Expo / React Native | Single codebase for iOS, Android, and web. File-based routing via Expo Router. |
| **Styling** | NativeWind | Tailwind CSS utility classes on React Native — familiar DX, consistent cross-platform look. |
| **State** | Zustand + React Query | Zustand for synchronous client state; React Query for async server state with caching and refetching. |
| **CI/CD** | GitHub Actions | Native GitHub integration. Separate workflows for CI (lint/test/deploy) and UAT (per-PR environments). |
| **Observability** | Cloudflare Analytics + Sentry | Built-in Workers observability for request metrics. Sentry for error tracking in production. |
