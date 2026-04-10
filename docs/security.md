# Scribe Security

## Authentication

Scribe uses email-based passwordless authentication:

1. **Email Verification**: Sign in with a 6-digit OTP (one-time password) sent to your email
2. **Session Tokens**: After verification, a secure session token is issued (valid for 30 days)
3. **Per-User Data Isolation**: Each user can only access their own documents

### How it works

```
User enters email → OTP sent → User enters code → Session token issued
                                                  → Stored securely on device
```

- OTP codes expire after 5 minutes
- Session tokens are SHA-256 hashed before storage in the database
- On mobile, tokens are stored in the OS secure keychain (expo-secure-store)
- On web, tokens are stored in localStorage (use HTTPS in production)

## Data Isolation

- Every document is tagged with its owner's user ID
- All database queries filter by the authenticated user's ID
- You cannot read, edit, or delete another user's documents
- Even API-level access respects ownership boundaries

## API Authentication

Three authentication methods are supported:

| Method | Use Case | How |
|--------|----------|-----|
| **Session Token** | Mobile/web app | `Authorization: Bearer <session_token>` |
| **API Key** | Admin/MCP connector | `X-API-Key: <key>` (admin only) |
| **Cloudflare Access** | Enterprise SSO | CF-Authorization JWT header |

## MCP Security

The Model Context Protocol endpoint (`/mcp`) is secured with:

- Bearer token authentication in production
- Token must be configured as a Cloudflare Worker secret
- In development, auth is relaxed for testing

## Rate Limiting

To prevent abuse, API requests are rate-limited:

| Endpoint | Limit |
|----------|-------|
| Claude AI operations | 10 requests/minute |
| Document operations | 60 requests/minute |
| General API | 120 requests/minute |

## Input Validation

- All inputs are validated with Zod schemas
- Request bodies are limited to 1 MB
- XSS patterns are stripped from all inputs
- SQL injection is prevented by the Drizzle ORM query builder

## Infrastructure Security

- All traffic is encrypted via HTTPS (Cloudflare edge)
- CORS is restricted to allowed origins in production
- Cloudflare Workers run in isolated V8 contexts
- D1 (SQLite) databases are encrypted at rest
- Secrets are managed via Cloudflare Workers secrets (not environment variables)

## Reporting Vulnerabilities

If you discover a security issue, please email the project maintainer directly. Do not open a public issue.
