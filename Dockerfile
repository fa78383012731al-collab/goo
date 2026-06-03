FROM node:24-slim

RUN apt-get update && apt-get install -y \
    ghostscript \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

WORKDIR /app

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY tsconfig.base.json ./
COPY tsconfig.json ./

COPY lib/db/package.json ./lib/db/
COPY lib/db/tsconfig.json ./lib/db/
COPY lib/db/drizzle.config.ts ./lib/db/
COPY lib/db/src ./lib/db/src

COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/api-server/tsconfig.json ./artifacts/api-server/
COPY artifacts/api-server/build.mjs ./artifacts/api-server/
COPY artifacts/api-server/src ./artifacts/api-server/src

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @workspace/db run build
RUN pnpm --filter @workspace/api-server run build

EXPOSE 8080

CMD ["sh", "-c", "pnpm --filter @workspace/db run push && node --enable-source-maps ./artifacts/api-server/dist/index.mjs"]
