# Scribe

![CI](https://github.com/vishal-reddy/scribe/workflows/CI/badge.svg)

A Claude-powered collaborative markdown document editor

## Overview

Scribe is a modern, real-time collaborative markdown editor that leverages Claude AI to enhance your writing experience. Built with cutting-edge web technologies, Scribe delivers a seamless editing experience across all platforms.

### Key Features

- **Real-time Collaboration**: Work together with your team in real-time using advanced CRDT technology
- **Claude AI Integration**: Enhance your writing with AI-powered suggestions, formatting, and content generation
- **Cross-platform**: Built with React Native, running seamlessly on web, iOS, and Android
- **Serverless Architecture**: Powered by Cloudflare Workers for global low-latency access
- **Conflict-free Editing**: Y.js CRDT ensures smooth collaborative editing without conflicts

## Tech Stack

- **Backend**: Cloudflare Workers (serverless edge computing)
- **Frontend**: React Native (cross-platform UI)
- **Collaboration**: Y.js (CRDT for real-time synchronization)
- **AI**: Claude API integration
- **Database**: Cloudflare D1 (SQLite at the edge)
- **Storage**: Cloudflare R2 (object storage)

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- Cloudflare account with Workers enabled
- Claude API key

### Installation

```bash
# Clone the repository
git clone https://github.com/vishal-reddy/scribe.git
cd scribe

# Install dependencies
npm install

# Set up environment variables
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your API keys

# Run in development mode
npm run dev
```

### Development

```bash
# Start the development server
npm run dev

# Run tests
npm test

# Type-check
npm run typecheck

# Deploy to Cloudflare
npm run deploy
```

### Deployment

Scribe uses GitHub Actions for automated deployment:

#### Production Deployment
- **Trigger**: Push to `main` branch
- **Process**: Automatic type-checking, testing, and deployment to Cloudflare Workers
- **Approval**: Requires manual approval via GitHub environment protection
- **Database**: Uses `scribe-db` D1 database

#### UAT Environment (Pull Requests)
- **Trigger**: Opening or updating a pull request
- **Features**:
  - Automatic deployment to PR-specific worker (`scribe-uat-pr-{PR_NUMBER}`)
  - Isolated D1 database for each PR
  - Comment on PR with deployment URL
  - Automatic cleanup when PR is closed
- **URL Pattern**: `https://scribe-uat-pr-{PR_NUMBER}.vishal-reddy.workers.dev`

#### Required Secrets
Configure these in your GitHub repository settings (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN`: API token with Workers and D1 permissions
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID

#### GitHub Environment Setup
Create a `production` environment in your repository settings (Settings → Environments):
1. Click "New environment" and name it `production`
2. Add required reviewers for manual deployment approval
3. (Optional) Add deployment protection rules

## Documentation

- [Architecture Overview](docs/architecture.md)
- [API Documentation](docs/api.md)
- [Deployment Guide](docs/deployment.md)
- [Contributing Guidelines](CONTRIBUTING.md)

## Project Structure

```
scribe/
├── packages/
│   ├── backend/        # Cloudflare Workers backend
│   ├── mobile/         # React Native mobile app
│   └── shared/         # Shared types and utilities
├── docs/               # Documentation
└── scripts/            # Build and deployment scripts
```

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Cloudflare Workers](https://workers.cloudflare.com/)
- Powered by [Claude AI](https://anthropic.com/claude)
- Real-time collaboration with [Y.js](https://github.com/yjs/yjs)
- UI framework: [React Native](https://reactnative.dev/)

## Contact

For questions or support, please open an issue or reach out to the maintainers.

---

**Status**: 🚧 Under active development
