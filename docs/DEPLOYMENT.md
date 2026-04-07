# Scribe Deployment Guide

This guide covers production deployment, UAT environments, CI/CD pipelines, and operational procedures.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [GitHub Secrets Configuration](#github-secrets-configuration)
- [Cloudflare Access Setup](#cloudflare-access-setup)
- [D1 Database Setup and Migrations](#d1-database-setup-and-migrations)
- [Durable Object Migrations](#durable-object-migrations)
- [Environment Variables and Secrets](#environment-variables-and-secrets)
- [CI/CD Pipelines](#cicd-pipelines)
- [Manual Deployment](#manual-deployment)
- [Monitoring and Observability](#monitoring-and-observability)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **Cloudflare account** | Paid Workers plan required for Durable Objects |
| **Node.js** | v18+ |
| **Wrangler CLI** | Installed globally or via npx (`npm i -g wrangler`) |
| **Anthropic API key** | From [console.anthropic.com](https://console.anthropic.com/) |
| **GitHub repository** | With Actions enabled |
| **Cloudflare API token** | With permissions: Workers Scripts (Edit), D1 (Edit), Account Settings (Read) |

---

## GitHub Secrets Configuration

Navigate to your repository → **Settings → Secrets and variables → Actions** and add:

| Secret | Description | How to obtain |
|--------|-------------|---------------|
| `CLOUDFLARE_API_TOKEN` | API token with Workers and D1 permissions | Cloudflare Dashboard → My Profile → API Tokens → Create Token |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID | Cloudflare Dashboard → any zone → Overview → right sidebar |

### Creating the Cloudflare API Token

1. Go to **Cloudflare Dashboard → My Profile → API Tokens**
2. Click **Create Token**
3. Use the **Custom token** template
4. Set permissions:
   - **Account** → Workers Scripts → **Edit**
   - **Account** → D1 → **Edit**
   - **Account** → Account Settings → **Read**
5. Set **Account Resources** to your account
6. Click **Continue to summary → Create Token**
7. Copy the token and add it as `CLOUDFLARE_API_TOKEN` in GitHub Secrets

### GitHub Environment Setup

Create a `production` environment for deployment approval:

1. Go to **Settings → Environments → New environment**
2. Name it `production`
3. Enable **Required reviewers** and add your team
4. Optionally configure **Deployment branches** to `main` only

---

## Cloudflare Access Setup

Scribe uses [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) for authentication. Access issues JWT tokens that the Scribe auth middleware validates.

### 1. Enable Cloudflare Zero Trust

1. Navigate to **Cloudflare Dashboard → Zero Trust**
2. Set up your team domain (e.g., `yourteam.cloudflareaccess.com`)

### 2. Create an Access Application

1. Go to **Zero Trust → Access → Applications → Add an application**
2. Choose **Self-hosted**
3. Configure:
   - **Application name**: Scribe
   - **Application domain**: your Worker's domain (e.g., `scribe.yourdomain.com`)
   - **Session duration**: 24 hours (recommended)
4. Add an **Access Policy**:
   - **Policy name**: Allow team members
   - **Action**: Allow
   - **Include**: Emails ending in `@yourdomain.com` (or specific emails)
5. Save the application

### 3. Note the Audience Tag

After creating the application, copy the **Application Audience (AUD) Tag** from the application settings. You'll need this for JWT validation.

### 4. Configure Environment Variables

```bash
wrangler secret put CF_ACCESS_TEAM_DOMAIN
# Enter: yourteam.cloudflareaccess.com

wrangler secret put CF_ACCESS_AUDIENCE
# Enter: <your-audience-tag>
```

---

## D1 Database Setup and Migrations

### Initial Setup

1. **Create the production database:**

   ```bash
   wrangler d1 create scribe-db
   ```

   This outputs a database ID. Update `wrangler.toml` if the ID differs:

   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "scribe-db"
   database_id = "<your-database-id>"
   migrations_dir = "src/db/migrations"
   ```

2. **Generate migrations from the Drizzle schema:**

   ```bash
   npm run db:generate
   ```

   This reads `src/db/schema.ts` and generates SQL migration files in `src/db/migrations/`.

3. **Apply migrations to the local database:**

   ```bash
   npm run db:migrate
   ```

4. **Apply migrations to the production database:**

   ```bash
   wrangler d1 migrations apply scribe-db --remote
   ```

### Adding New Migrations

When you modify `src/db/schema.ts`:

```bash
# Generate a new migration
npm run db:generate

# Test locally
npm run db:migrate

# Apply to production
wrangler d1 migrations apply scribe-db --remote
```

### Inspecting the Database

```bash
# Open Drizzle Studio (local GUI)
npm run db:studio

# Run a query against production
wrangler d1 execute scribe-db --remote --command "SELECT count(*) FROM documents"
```

---

## Durable Object Migrations

Durable Objects require explicit migration declarations in `wrangler.toml`. The current configuration:

```toml
[[durable_objects.bindings]]
name = "DOCUMENT_SYNC"
class_name = "DocumentSync"

[[migrations]]
tag = "v1"
new_classes = ["DocumentSync"]
```

### Adding a New Durable Object Class

If you add a new Durable Object (e.g., `UserPresence`):

1. Create the class in `src/durable-objects/UserPresence.ts`
2. Export it from `src/index.ts`
3. Add to `wrangler.toml`:

   ```toml
   [[durable_objects.bindings]]
   name = "USER_PRESENCE"
   class_name = "UserPresence"

   [[migrations]]
   tag = "v2"
   new_classes = ["UserPresence"]
   ```

### Renaming or Deleting Durable Objects

Use `renamed_classes` or `deleted_classes` in migrations:

```toml
[[migrations]]
tag = "v3"
renamed_classes = [{ from = "OldName", to = "NewName" }]
# OR
deleted_classes = ["DeprecatedClass"]
```

> **Warning**: Deleting a Durable Object class destroys all its stored data. This cannot be undone.

---

## Environment Variables and Secrets

### Runtime Variables (`wrangler.toml` `[vars]`)

```toml
[vars]
ENVIRONMENT = "production"
```

These are visible in source control. Use only for non-sensitive values.

### Secrets (encrypted, set via Wrangler)

```bash
# Required
wrangler secret put ANTHROPIC_API_KEY

# Optional (for Cloudflare Access)
wrangler secret put CF_ACCESS_TEAM_DOMAIN
wrangler secret put CF_ACCESS_AUDIENCE

# Optional (for error tracking)
wrangler secret put SENTRY_DSN
```

### Managing Secrets

```bash
# List all secrets
wrangler secret list

# Delete a secret
wrangler secret delete SECRET_NAME
```

### Local Development

For local dev, secrets go in `.dev.vars` (git-ignored):

```
ANTHROPIC_API_KEY=sk-ant-api03-...
CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
CF_ACCESS_AUDIENCE=your-audience-tag
```

---

## CI/CD Pipelines

### CI Pipeline (`ci.yml`)

**Trigger:** Push to `main` or any pull request targeting `main`.

```
┌──────────────┐       ┌───────────────────┐
│   check      │       │   deploy          │
│              │       │                   │
│ • checkout   │       │ • checkout        │
│ • npm ci     │──────▶│ • npm ci          │
│ • tsc        │ pass  │ • wrangler deploy │
│ • npm test   │       │                   │
└──────────────┘       └───────────────────┘
                       (main push only,
                        requires approval)
```

| Job | Runs on | Condition |
|-----|---------|-----------|
| `check` | Every push and PR | Always |
| `deploy` | Push to `main` only | After `check` passes, requires `production` environment approval |

The deploy job uses a **concurrency group** (`production-deploy`) to prevent overlapping deployments.

### UAT Pipeline (`uat.yml`)

**Trigger:** Pull request opened, updated (`synchronize`), reopened, or closed.

#### On PR Open/Update

```
┌─────────────────────┐
│  deploy-uat         │
│                     │
│  • checkout         │
│  • npm ci           │
│  • tsc + test       │
│  • Create/reuse     │
│    D1 database      │
│  • Generate UAT     │
│    wrangler.toml    │
│  • wrangler deploy  │
│  • Comment URL      │
│    on PR            │
└─────────────────────┘
```

Each PR gets:
- **Isolated Worker**: `scribe-uat-pr-{PR_NUMBER}`
- **Isolated D1 database**: `scribe-uat-pr-{PR_NUMBER}`
- **URL**: `https://scribe-uat-pr-{PR_NUMBER}.vishal-reddy.workers.dev`
- **Environment variable**: `ENVIRONMENT=uat`

A bot comment is posted on the PR with the deployment URL and health check link.

#### On PR Close/Merge

```
┌─────────────────────┐
│  cleanup-uat        │
│                     │
│  • Delete Worker    │
│  • Delete D1 DB     │
│  • Comment cleanup  │
│    on PR            │
└─────────────────────┘
```

Resources are cleaned up automatically via the Cloudflare API.

**Concurrency:** `uat-pr-{PR_NUMBER}` — prevents parallel deployments for the same PR and cancels in-progress runs on new pushes.

---

## Manual Deployment

### Deploy to Production

```bash
# Full deploy
npm run deploy

# Or explicitly
npx wrangler deploy
```

### Deploy with Migrations

```bash
# Apply migrations first
wrangler d1 migrations apply scribe-db --remote

# Then deploy the worker
npx wrangler deploy
```

### Deploy to a Custom Environment

```bash
npx wrangler deploy --env staging
```

---

## Monitoring and Observability

### Built-in Cloudflare Observability

Observability is enabled in `wrangler.toml`:

```toml
[observability]
enabled = true
```

This provides:
- **Request logs** in the Cloudflare Dashboard → Workers → your worker → Logs
- **Real-time log streaming** via `wrangler tail`
- **Analytics** (requests, errors, CPU time, duration)

### Structured Logging

Scribe uses a custom structured logger (`src/middleware/logger.ts`) that outputs JSON logs:

```json
{
  "level": "info",
  "message": "Request completed",
  "requestId": "550e8400-...",
  "method": "GET",
  "path": "/api/documents",
  "status": 200,
  "duration": 42,
  "slow": false,
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

Slow requests (>1 second) are flagged with `"slow": true`. Very slow requests (>3 seconds) log at `WARN` level.

### Cloudflare Analytics Engine

If the `ANALYTICS` binding is configured, per-request metrics are written to Cloudflare Analytics Engine:

- **Blobs**: HTTP method, path, status code
- **Doubles**: Duration in milliseconds
- **Indexes**: `METHOD:path` for querying

### Error Tracking (Sentry)

Set the `SENTRY_DSN` secret to enable Sentry error reporting for 5xx errors in production.

### Real-time Log Tailing

```bash
# Stream live logs from production
wrangler tail

# Filter by status
wrangler tail --format json | jq 'select(.outcome == "exception")'
```

### Health Checks

Set up external monitoring (e.g., UptimeRobot, Pingdom) to poll:

- `GET /health` — basic liveness check
- `GET /ready` — dependency readiness (D1 + Durable Objects)

---

## Rollback Procedures

### Quick Rollback (Previous Worker Version)

Cloudflare keeps previous Worker deployments. To rollback:

1. Go to **Cloudflare Dashboard → Workers → scribe → Deployments**
2. Find the previous stable deployment
3. Click **Rollback to this deployment**

Or via CLI:

```bash
# List recent deployments
npx wrangler deployments list

# Rollback to a specific deployment
npx wrangler rollback <deployment-id>
```

### Rollback via Git

```bash
# Revert the bad commit
git revert HEAD
git push origin main
# CI will auto-deploy the reverted version
```

### Database Rollback

D1 does not support automatic rollbacks. For schema changes:

1. Write a new **reverse migration** that undoes the change
2. Apply it: `wrangler d1 migrations apply scribe-db --remote`

For data issues:

```bash
# Export data for backup
wrangler d1 execute scribe-db --remote --command "SELECT * FROM documents" --json > backup.json

# Fix data
wrangler d1 execute scribe-db --remote --command "UPDATE documents SET ..."
```

### Durable Object State

Durable Object storage cannot be rolled back automatically. If Y.js state is corrupted:

1. The Durable Object can be reset by deleting its storage
2. The document will reload from D1 on next connection
3. Users may lose unsaved real-time edits

---

## Troubleshooting

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `401 Unauthorized` on all requests | Missing or expired JWT | Check Cloudflare Access config, verify token format |
| `500` on Claude endpoints | Invalid/missing `ANTHROPIC_API_KEY` | Run `wrangler secret put ANTHROPIC_API_KEY` |
| WebSocket connection refused | Durable Object not deployed | Ensure `[[migrations]]` tags are sequential in `wrangler.toml` |
| D1 query failures | Migrations not applied | Run `wrangler d1 migrations apply scribe-db --remote` |
| UAT deploy fails | Missing GitHub secrets | Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` |
| `503 not ready` on `/ready` | D1 database unreachable | Check D1 status in Cloudflare Dashboard |

### Useful Commands

```bash
# Check Worker status
wrangler whoami

# List D1 databases
wrangler d1 list

# Check migration status
wrangler d1 migrations list scribe-db --remote

# Stream production logs
wrangler tail

# Test health locally
curl http://localhost:8787/health
curl http://localhost:8787/ready
```
