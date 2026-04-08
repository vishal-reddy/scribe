# Contributing to Scribe

Thank you for your interest in contributing to Scribe! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Commit Message Convention](#commit-message-convention)
- [Branch Naming](#branch-naming)

## Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- Git
- Cloudflare account (free tier works)
- Anthropic API key

### Initial Setup

1. **Fork the repository** on GitHub

2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/scribe.git
   cd scribe
   ```

3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/vishal-reddy/scribe.git
   ```

4. **Install dependencies**:
   ```bash
   # Backend
   npm install
   
   # Frontend
   cd mobile
   npm install
   cd ..
   ```

5. **Set up environment**:
   ```bash
   cp .dev.vars.example .dev.vars
   # Edit .dev.vars and add your ANTHROPIC_API_KEY
   ```

6. **Initialize database**:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```

7. **Verify setup**:
   ```bash
   npm run dev         # Start backend
   cd mobile && npm start  # Start frontend (in separate terminal)
   ```

## Development Workflow

### Keeping Your Fork Up-to-Date

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

### Creating a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

### Running the Development Environment

```bash
# Terminal 1: Backend (with hot reload)
npm run dev

# Terminal 2: Frontend
cd mobile
npm start

# Terminal 3: TypeScript watch mode (optional)
npm run typecheck -- --watch
```

### Database Operations

```bash
# Generate new migration from schema changes
npm run db:generate

# Apply migrations to local D1
npm run db:migrate

# Open Drizzle Studio (GUI for database)
npm run db:studio
```

### Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- src/routes/documents.test.ts

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage

# Frontend tests
cd mobile
npm test
```

## Pull Request Process

### Before Submitting

1. ✅ **Run tests**: `npm test` (backend) and `cd mobile && npm test` (frontend)
2. ✅ **Type-check**: `npm run typecheck`
3. ✅ **Format code**: Ensure consistent formatting
4. ✅ **Update documentation**: If you changed APIs or added features
5. ✅ **Add tests**: For new features or bug fixes
6. ✅ **Check commits**: Follow commit message convention

### Submitting a Pull Request

1. **Push your branch** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Open a Pull Request** on GitHub:
   - Use a clear, descriptive title
   - Fill out the PR template completely
   - Link related issues using "Fixes #123" or "Closes #456"
   - Add screenshots for UI changes

3. **Wait for CI checks** to pass:
   - TypeScript compilation
   - Test suite
   - UAT deployment (automatic for PRs)

4. **Address review feedback**:
   - Make requested changes
   - Push new commits to the same branch
   - Respond to comments

5. **Squash and merge** (done by maintainers after approval)

### PR Review Process

- At least one maintainer review is required
- CI must pass (all tests, type-checking)
- UAT deployment must succeed
- Documentation must be updated if needed
- No merge conflicts with main branch

## Coding Standards

### TypeScript

- **Strict mode**: Always enabled
- **No `any` types**: Use proper types or `unknown`
- **Explicit return types**: For public functions
- **Interface over type**: For object shapes

### Code Style

```typescript
// ✅ Good
export interface Document {
  id: string;
  title: string;
  content: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function getDocument(id: string): Promise<Document | null> {
  // Implementation
}

// ❌ Avoid
export type Document = any;

export async function getDocument(id) {
  // Implementation
}
```

### File Organization

- **One component per file**: Exception: small utility components
- **Co-locate tests**: `component.tsx` → `component.test.tsx`
- **Named exports**: Prefer over default exports
- **Barrel exports**: Use index.ts for public APIs

### Backend Conventions

```typescript
// Route handlers use Hono Context
app.get('/api/documents/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId'); // From auth middleware
  
  // Business logic
  const document = await getDocument(id, userId);
  
  if (!document) {
    return c.json({ error: 'Document not found' }, 404);
  }
  
  return c.json({ document }, 200);
});
```

### Frontend Conventions

```typescript
// Components use TypeScript + React hooks
interface DocumentCardProps {
  document: Document;
  onPress: (id: string) => void;
}

export function DocumentCard({ document, onPress }: DocumentCardProps) {
  const handlePress = () => onPress(document.id);
  
  return (
    <TouchableOpacity onPress={handlePress}>
      <Text>{document.title}</Text>
    </TouchableOpacity>
  );
}
```

### Comments

- **Document "why", not "what"**: Code should be self-explanatory
- **JSDoc for public APIs**: Exported functions, components, types
- **TODO comments**: Include issue number: `// TODO(#123): Fix edge case`

## Testing Guidelines

### Backend Tests (Vitest)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('Document API', () => {
  beforeEach(async () => {
    // Setup test database
  });
  
  it('should create a new document', async () => {
    const response = await request('/api/documents')
      .post({ title: 'Test', content: 'Content' })
      .set('Authorization', 'Bearer token');
    
    expect(response.status).toBe(201);
    expect(response.body.document).toMatchObject({
      title: 'Test',
      content: 'Content',
    });
  });
});
```

### Frontend Tests (Jest + RTL)

```typescript
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { DocumentCard } from './DocumentCard';

describe('DocumentCard', () => {
  it('should call onPress when tapped', () => {
    const onPress = jest.fn();
    const document = { id: '1', title: 'Test', content: 'Content' };
    
    const { getByText } = render(
      <DocumentCard document={document} onPress={onPress} />
    );
    
    fireEvent.press(getByText('Test'));
    
    expect(onPress).toHaveBeenCalledWith('1');
  });
});
```

### Test Coverage

- **Minimum**: 70% coverage
- **Priority**: Critical paths (auth, CRUD, sync)
- **Mock external services**: Anthropic API, D1 database
- **E2E tests**: For critical user flows

## Commit Message Convention

We use [Conventional Commits](https://www.conventionalcommits.org/) for clear git history:

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting, no logic change)
- **refactor**: Code refactoring
- **perf**: Performance improvements
- **test**: Adding or updating tests
- **chore**: Maintenance tasks (deps, config)
- **ci**: CI/CD changes

### Examples

```bash
feat(mobile): add document search functionality

Implemented full-text search for documents using SQLite FTS5.
Added search bar to home screen with debounced input.

Closes #45

---

fix(api): resolve race condition in Y.js sync

The DocumentSync durable object had a race condition when
multiple clients connected simultaneously. Added proper locking
using atomic operations.

Fixes #123

---

docs(readme): update installation instructions

Added steps for M1/M2 Mac users experiencing SQLite issues.

---

chore(deps): upgrade Hono to v4.6.1
```

### Rules

- **Subject line**: Max 72 characters
- **Imperative mood**: "add" not "added" or "adds"
- **No period**: At end of subject
- **Body**: Wrap at 72 characters, explain "what" and "why"
- **Footer**: Reference issues/PRs

## Branch Naming

Use descriptive branch names with prefixes:

### Format

```
<type>/<short-description>
```

### Types

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation
- `refactor/` - Code refactoring
- `test/` - Test additions/changes
- `chore/` - Maintenance

### Examples

```bash
feature/document-search
fix/yjs-race-condition
docs/api-documentation
refactor/extract-sync-logic
test/add-claude-integration-tests
chore/upgrade-dependencies
```

## Additional Resources

- **Architecture**: See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **API Docs**: See [docs/API.md](docs/API.md)
- **Deployment**: See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **User Guide**: See [docs/USER_GUIDE.md](docs/USER_GUIDE.md)

## Questions?

- 💬 **Discussions**: [GitHub Discussions](https://github.com/vishal-reddy/scribe/discussions)
- 📧 **Issues**: [GitHub Issues](https://github.com/vishal-reddy/scribe/issues)

Thank you for contributing to Scribe! 🚀
