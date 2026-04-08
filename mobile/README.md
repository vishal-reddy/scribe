# Scribe Mobile App

React Native mobile application built with Expo and Expo Router.

## Tech Stack

- **Expo SDK 54** - React Native framework
- **Expo Router** - File-based navigation
- **NativeWind** - Tailwind CSS for React Native
- **TypeScript** - Type safety
- **React Query** - Data fetching and caching
- **Zustand** - State management
- **Axios** - HTTP client

## Project Structure

```
app/
  _layout.tsx          # Root layout with navigation
  index.tsx            # Home/document list screen
  auth/
    login.tsx          # Login screen
  document/
    [id].tsx           # Document editor (dynamic route)
  claude.tsx           # Claude chat interface
  settings.tsx         # Settings screen
components/            # Reusable components
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

Dependencies are already installed. To reinstall:

```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your backend URL:
```
EXPO_PUBLIC_API_URL=http://localhost:8787
EXPO_PUBLIC_WS_URL=ws://localhost:8787
```

### Development

Run on different platforms:

```bash
# Web (runs on http://localhost:8081)
npm run web

# iOS Simulator
npm run ios

# Android Emulator
npm run android

# Start dev server (choose platform interactively)
npm start
```

## Features Implemented

✅ Expo Router file-based navigation
✅ NativeWind (Tailwind CSS) styling
✅ TypeScript configuration
✅ Multi-platform support (iOS, Android, Web)
✅ Basic routing structure
✅ Development environment setup

## Next Steps

1. Implement authentication flow
2. Connect to backend API
3. Build document editor with real-time sync
4. Integrate Claude chat functionality
5. Add offline support with local storage
6. Implement WebSocket for real-time updates

## Notes

- Using `--legacy-peer-deps` flag for npm installs due to React version dependencies
- NativeWind preset is required in `tailwind.config.js`
- TypeScript types for NativeWind are in `nativewind-env.d.ts`
