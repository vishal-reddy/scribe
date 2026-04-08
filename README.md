# Scribe

![CI](https://github.com/vishal-reddy/scribe/workflows/CI/badge.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> *"As Aquinas sought truth through reason and contemplation, Scribe seeks clarity through words and collaboration with Claude."*

A modern, real-time collaborative markdown editor powered by Claude AI, built for seamless writing and editing across all platforms.

## 📖 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Development](#development)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [Project Structure](#project-structure)
- [API Overview](#api-overview)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Overview

**Scribe** is a cloud-native collaborative document editor that brings together the power of real-time synchronization (via Y.js CRDTs), serverless edge computing (Cloudflare Workers), and AI-powered writing assistance (Claude AI). Named after the scholarly tradition, Scribe enables users to collaborate with both humans and AI in crafting documents.

### The Aquinas & Scribe Metaphor

Just as Thomas Aquinas served as a bridge between faith and reason, synthesizing knowledge from multiple sources, **Scribe** serves as a bridge between human creativity and AI capabilities, synthesizing insights to create better documents through collaboration.

## Features

### ✨ Core Features

- **🤖 Claude AI Integration**: Collaborate with Claude to write, edit, and refine documents using natural language prompts
- **⚡ Real-time Collaboration**: Multiple users can edit simultaneously with conflict-free synchronization via Y.js CRDTs
- **🌍 Edge-first Architecture**: Powered by Cloudflare Workers for global low-latency access from anywhere
- **📱 Cross-platform**: Built with Expo and React Native - runs on iOS, Android, and Web
- **🔄 Version History**: Automatic snapshots and full audit trail of all edits
- **🔒 Secure by Default**: JWT-based authentication with Cloudflare Access support
- **📊 MCP Integration**: Model Context Protocol server for advanced Claude interactions

### 🎯 Advanced Features

- **Conflict Detection**: Intelligent detection of simultaneous user/AI edits
- **Live Notifications**: Real-time alerts when Claude edits documents
- **Document Artifacts**: Claude can create and manage documents as persistent artifacts
- **WebSocket Sync**: Real-time document synchronization via Durable Objects
- **Search**: Full-text search across all documents
- **Audit Log**: Complete history of all Claude interactions

## Architecture

Scribe follows a modern serverless architecture with edge-first principles:

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Layer                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │   Expo App (iOS/Android/Web)                         │   │
│  │   - React Native + NativeWind                        │   │
│  │   - Y.js Client                                      │   │
│  │   - WebSocket Connection                             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTPS/WSS
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Cloudflare Workers Edge                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │   Hono API Server                                    │   │
│  │   ├── /api/documents   (CRUD)                        │   │
│  │   ├── /api/claude      (AI operations)               │   │
│  │   ├── /api/sync        (WebSocket upgrades)          │   │
│  │   └── /mcp             (Model Context Protocol)      │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                 │
│           ┌────────────────┼────────────────┐               │
│           ▼                ▼                ▼               │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ Durable      │ │ Cloudflare   │ │ Anthropic    │        │
│  │ Objects      │ │ D1 Database  │ │ Claude API   │        │
│  │ (Y.js sync)  │ │ (SQLite)     │ │              │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

1. **Frontend (Expo/React Native)**: Cross-platform mobile app with Y.js for CRDT synchronization
2. **Backend (Cloudflare Workers)**: Serverless API built with Hono framework
3. **Database (D1)**: SQLite at the edge for document persistence
4. **Durable Objects**: WebSocket coordination and Y.js state management
5. **Claude AI**: Document creation, editing, and enhancement via Anthropic API
6. **MCP Server**: Model Context Protocol implementation for advanced AI interactions

For detailed architecture documentation, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Technology Stack

### Backend
- **Runtime**: [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless edge computing
- **Framework**: [Hono](https://hono.dev/) - Lightweight web framework
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) - Distributed SQLite
- **ORM**: [Drizzle ORM](https://orm.drizzle.team/) - Type-safe database toolkit
- **Real-time**: [Durable Objects](https://developers.cloudflare.com/durable-objects/) - Stateful WebSocket coordination
- **CRDT**: [Y.js](https://github.com/yjs/yjs) - Conflict-free collaborative editing
- **AI**: [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) - Claude integration
- **Validation**: [Zod](https://zod.dev/) - Schema validation

### Frontend
- **Framework**: [Expo](https://expo.dev/) - React Native development platform
- **UI**: [NativeWind](https://www.nativewind.dev/) - Tailwind CSS for React Native
- **State**: [Zustand](https://zustand-demo.pmnd.rs/) - Lightweight state management
- **Data Fetching**: [TanStack Query](https://tanstack.com/query) - Async state management
- **CRDT**: [Y.js](https://github.com/yjs/yjs) - Client-side synchronization

### DevOps
- **CI/CD**: GitHub Actions
- **Testing**: [Vitest](https://vitest.dev/)
- **Type-checking**: TypeScript 6+
- **Deployment**: Wrangler (Cloudflare CLI)

## Getting Started

### Prerequisites

- **Node.js**: 18 or higher
- **npm**: 9 or higher (or yarn/pnpm)
- **Cloudflare Account**: Free tier is sufficient for development
- **Anthropic API Key**: Sign up at [console.anthropic.com](https://console.anthropic.com/)
- **Git**: For version control

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/vishal-reddy/scribe.git
   cd scribe
   ```

2. **Install backend dependencies**:
   ```bash
   npm install
   ```

3. **Install mobile app dependencies**:
   ```bash
   cd mobile
   npm install
   cd ..
   ```

4. **Set up environment variables**:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   
   Edit `.dev.vars` and add your Anthropic API key:
   ```
   ANTHROPIC_API_KEY=sk-ant-api03-...
   ```

5. **Initialize the database**:
   ```bash
   # Generate migrations
   npm run db:generate
   
   # Apply migrations to local D1
   npm run db:migrate
   ```

6. **Start the development server**:
   ```bash
   npm run dev
   ```
   
   The API will be available at `http://localhost:8787`

7. **Start the mobile app** (in a separate terminal):
   ```bash
   cd mobile
   npm start
   ```
   
   Choose your platform:
   - Press `i` for iOS Simulator
   - Press `a` for Android Emulator
   - Press `w` for Web

### Development

```bash
# Backend development server (with hot reload)
npm run dev

# Run tests
npm test

# Type-check
npm run typecheck

# Database operations
npm run db:generate    # Generate migrations from schema changes
npm run db:migrate     # Apply migrations to local D1
npm run db:studio      # Open Drizzle Studio (DB GUI)

# Mobile app
cd mobile
npm start              # Start Expo dev server
npm run ios            # Run on iOS
npm run android        # Run on Android
npm run web            # Run on Web
```

## Environment Variables

### Backend (`/.dev.vars` for local development)

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key for Claude integration |

### Production Secrets

Set these via Wrangler for production:
```bash
# Set API key
wrangler secret put ANTHROPIC_API_KEY

# List all secrets
wrangler secret list
```

### Mobile App (`/mobile/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_API_URL` | Yes | Backend API URL (e.g., `http://localhost:8787` or production URL) |

## Deployment

Scribe uses **GitHub Actions** for automated CI/CD with separate production and UAT environments.

### Production Deployment

**Trigger**: Push to `main` branch

**Workflow**:
1. ✅ Type-checking and tests run automatically
2. 🚀 Deploy to Cloudflare Workers (requires manual approval)
3. 📊 Database migrations applied automatically

**Prerequisites**:
- Create `production` environment in GitHub repository settings
- Add required reviewers for deployment approval
- Configure secrets (see below)

### UAT Environment (Pull Requests)

**Trigger**: Opening or updating a pull request

**Features**:
- 🔄 Automatic deployment to PR-specific worker: `scribe-uat-pr-{PR_NUMBER}`
- 🗄️ Isolated D1 database for each PR
- 💬 Bot comment on PR with deployment URL
- 🧹 Automatic cleanup when PR is closed/merged

**URL Pattern**: `https://scribe-uat-pr-123.vishal-reddy.workers.dev`

### Required GitHub Secrets

Configure these in **Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | API token with Workers and D1 permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

### Manual Deployment

```bash
# Deploy to production
npm run deploy

# Deploy with specific environment
wrangler deploy --env production
```

For detailed deployment instructions, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Project Structure

```
scribe/
├── src/                          # Backend source code
│   ├── index.ts                  # Main entry point
│   ├── types.ts                  # TypeScript types
│   ├── routes/                   # API route handlers
│   │   ├── documents.ts          # Document CRUD endpoints
│   │   ├── claude.ts             # Claude AI endpoints
│   │   ├── mcp.ts                # Model Context Protocol
│   │   ├── sync.ts               # WebSocket sync
│   │   └── health.ts             # Health checks
│   ├── db/                       # Database
│   │   ├── schema.ts             # Drizzle ORM schema
│   │   └── migrations/           # SQL migrations
│   ├── durable-objects/          # Durable Objects
│   │   └── DocumentSync.ts       # Y.js sync coordinator
│   ├── middleware/               # Hono middleware
│   │   ├── auth.ts               # Authentication
│   │   ├── logger.ts             # Request logging
│   │   └── error-handler.ts     # Error handling
│   └── lib/                      # Utilities
│       ├── yjs-utils.ts          # Y.js helpers
│       ├── notifications.ts      # Notification system
│       └── conflict-detection.ts # Edit conflict detection
├── mobile/                       # Frontend mobile app
│   ├── app/                      # Expo Router pages
│   │   ├── index.tsx             # Home screen
│   │   ├── claude.tsx            # Claude chat interface
│   │   ├── artifacts.tsx         # Document artifacts
│   │   ├── document/             # Document editor
│   │   └── settings.tsx          # App settings
│   ├── components/               # React components
│   ├── lib/                      # Frontend utilities
│   │   ├── api-client.ts         # API wrapper
│   │   ├── chat-service.ts       # Claude chat logic
│   │   └── theme.ts              # Theme configuration
│   ├── app.json                  # Expo configuration
│   └── package.json              # Dependencies
├── docs/                         # Documentation
│   ├── API.md                    # API reference
│   ├── ARCHITECTURE.md           # Architecture deep-dive
│   ├── DEPLOYMENT.md             # Deployment guide
│   └── USER_GUIDE.md             # User documentation
├── .github/                      # GitHub configuration
│   └── workflows/                # CI/CD workflows
│       ├── ci.yml                # Main CI/CD pipeline
│       └── uat.yml               # UAT environment
├── test/                         # Backend tests
├── scripts/                      # Build scripts
├── wrangler.toml                 # Cloudflare Workers config
├── package.json                  # Backend dependencies
├── drizzle.config.ts             # Drizzle ORM config
├── tsconfig.json                 # TypeScript config
├── CONTRIBUTING.md               # Contribution guidelines
├── CODE_OF_CONDUCT.md            # Code of conduct
└── README.md                     # This file
```

## API Overview

Scribe provides a RESTful API with the following main endpoints:

### Documents
- `GET /api/documents` - List all documents
- `GET /api/documents/:id` - Get document by ID
- `POST /api/documents` - Create new document
- `PATCH /api/documents/:id` - Update document
- `DELETE /api/documents/:id` - Delete document
- `GET /api/documents/:id/versions` - Get version history
- `POST /api/documents/:id/versions` - Create version snapshot

### Claude AI
- `POST /api/claude/prompt` - Send prompt to Claude
- `GET /api/claude/artifacts` - List all artifacts
- `GET /api/claude/artifacts/:id` - Get specific artifact
- `POST /api/claude/create` - Create document via Claude
- `POST /api/claude/edit/:id` - Edit document via Claude
- `GET /api/claude/history/:documentId` - Get edit history

### MCP (Model Context Protocol)
- `POST /mcp/tools/list` - List available MCP tools
- `POST /mcp/tools/call` - Execute MCP tool

### Sync
- `GET /api/sync/:documentId` - Upgrade to WebSocket for real-time sync

For complete API documentation with request/response examples, see [docs/API.md](docs/API.md).

## Documentation

- **[API Reference](docs/API.md)** - Complete API endpoint documentation
- **[Architecture Guide](docs/ARCHITECTURE.md)** - System design and data flow
- **[Deployment Guide](docs/DEPLOYMENT.md)** - Production deployment instructions
- **[User Guide](docs/USER_GUIDE.md)** - End-user documentation
- **[Mobile App README](mobile/README.md)** - Frontend-specific documentation
- **[Contributing Guidelines](CONTRIBUTING.md)** - How to contribute
- **[Code of Conduct](CODE_OF_CONDUCT.md)** - Community guidelines

## Contributing

We welcome contributions from the community! Please read our [Contributing Guidelines](CONTRIBUTING.md) before submitting pull requests.

### Quick Start for Contributors

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Run tests: `npm test`
5. Commit using conventional commits: `git commit -m "feat: add amazing feature"`
6. Push to your fork: `git push origin feature/amazing-feature`
7. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- **Inspiration**: Named after the scholarly tradition of scribes and Thomas Aquinas
- **Built with**:
  - [Cloudflare Workers](https://workers.cloudflare.com/) - Edge computing platform
  - [Claude AI](https://anthropic.com/claude) - AI writing assistant
  - [Y.js](https://github.com/yjs/yjs) - CRDT framework
  - [Hono](https://hono.dev/) - Web framework
  - [Expo](https://expo.dev/) - React Native platform
  - [Drizzle ORM](https://orm.drizzle.team/) - Database toolkit

## Support

- 📧 **Issues**: [GitHub Issues](https://github.com/vishal-reddy/scribe/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/vishal-reddy/scribe/discussions)
- 📖 **Documentation**: [docs/](docs/)

---

**Built with ❤️ by the Scribe team** | **Status**: 🚧 Active Development

*"In the pursuit of clarity through collaboration"*
