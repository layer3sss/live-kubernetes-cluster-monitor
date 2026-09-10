# syntax=docker/dockerfile:1

# ==============================================================================
# KubeMind - Build stage
# Installs all dependencies (incl. dev) and builds:
#   1. Vite client bundle  -> dist/
#   2. esbuild server      -> dist/server.cjs
# ==============================================================================
FROM oven/bun:1 AS build
WORKDIR /app

# Install dependencies first for optimal layer caching
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy sources required for the build
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
COPY server ./server
COPY server.ts ./

RUN bun run build

# Prune node_modules down to production dependencies only
RUN bun install --frozen-lockfile --production

# ==============================================================================
# Runtime stage: slim Node image, non-root (UID 1000, matches k8s manifest)
# ==============================================================================
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Production dependencies (express, ws, @kubernetes/client-node, ... are
# externalized by esbuild and therefore required at runtime)
COPY --from=build --chown=1000:1000 /app/node_modules ./node_modules

# Built artifacts: static client (dist/index.html + assets) and dist/server.cjs
COPY --from=build --chown=1000:1000 /app/dist ./dist

USER 1000

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
