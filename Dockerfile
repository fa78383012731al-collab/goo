FROM node:24-slim

RUN apt-get update && apt-get install -y \
    ghostscript \
    ffmpeg \
    python3 \
    make \
    g++ \
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

# Copy the api-server artifact
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/api-server/tsconfig.json ./artifacts/api-server/
COPY artifacts/api-server/build.mjs ./artifacts/api-server/
COPY artifacts/api-server/src ./artifacts/api-server/src

# Install without running any scripts (bypasses ERR_PNPM_IGNORED_BUILDS)
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# Rebuild native packages explicitly
RUN pnpm rebuild esbuild
RUN pnpm rebuild sharp

# Build the api-server (esbuild bundles everything including libs)
RUN pnpm --filter @workspace/api-server run build

EXPOSE 8080

# Push DB schema then start server
CMD ["sh", "-c", "pnpm --filter @workspace/db run push && node --enable-source-maps ./artifacts/api-server/dist/index.mjs"]
