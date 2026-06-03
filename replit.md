# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains a Telegram bot that uploads files (PDF, Word, PPTX, images, Excel, video) to Google Drive with folder management, QR code generation, and automatic file compression.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Telegram**: Telegraf (Webhook mode)
- **Google Drive**: googleapis (OAuth2 + Service Account)
- **Compression**: sharp (images), ghostscript (PDF), ffmpeg (video)
- **QR Codes**: qrcode
- **Build**: esbuild

## Telegram Bot (@drive6ghxj_bot)

### Commands
- `/start` — Welcome + Drive connection status
- `/menu` — Main menu
- `/status` — Current bot and project status
- `/cancel` — Cancel current operation
- `/help` — Usage guide

### Features
- **ملف أداء وظيفي**: Creates main folder + 11 fixed subfolders automatically with progress bar
- **ملف إنجاز**: Custom subfolders created on demand
- **File upload**: All file types, auto-compressed before upload
- **QR codes**: Generated for all folder links
- **Persistent state**: All projects/folders stored in PostgreSQL DB
- **Webhook mode**: More reliable than polling

### Secrets Required
- `TELEGRAM_BOT_TOKEN`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `DATABASE_URL` (auto-provisioned)
- Google OAuth refresh token stored in DB (settings table)

### Architecture
- `artifacts/api-server/src/bot/index.ts` — Main bot handlers
- `artifacts/api-server/src/bot/drive.ts` — Google Drive API (service account for folders, OAuth for file uploads)
- `artifacts/api-server/src/bot/oauth.ts` — OAuth2 flow and token management
- `artifacts/api-server/src/bot/storage.ts` — DB operations (projects, folders, sessions)
- `artifacts/api-server/src/bot/compress.ts` — File compression (sharp/ghostscript/ffmpeg)
- `artifacts/api-server/src/bot/qr.ts` — QR code generation
- `lib/db/src/schema/bot.ts` — DB schema (projects, folders, user_sessions)
- `lib/db/src/schema/settings.ts` — Settings table (OAuth tokens)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
