FROM node:24-slim

RUN apt-get update && apt-get install -y \
    ghostscript \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

WORKDIR /app

# Copy workspace config and lockfile first (for caching)
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
COPY tsconfig.base.json ./
COPY tsconfig.json ./

# Copy all lib packages (workspace dependencies)
COPY lib/db/package.json ./lib/db/
COPY lib/db/tsconfig.json ./lib/db/
COPY lib/db/drizzle.config.ts ./lib/db/
COPY lib/db/src ./lib/db/src

COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-zod/src ./lib/api-zod/src

# Copy the api-server artifact
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/api-server/tsconfig.json ./artifacts/api-server/
COPY artifacts/api-server/build.mjs ./artifacts/api-server/
COPY artifacts/api-server/src ./artifacts/api-server/src

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Build the api-server (esbuild bundles everything including libs)
RUN pnpm --filter @workspace/api-server run build

EXPOSE 8080

# Push DB schema then start server
CMD ["sh", "-c", "pnpm --filter @workspace/db run push && node --enable-source-maps ./artifacts/api-server/dist/index.mjs"]
