# ──────────────────────────────────────────────────────────────────
# Stage 1 — install all workspace deps (including devDeps for build)
# ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps

RUN npm install -g pnpm@10.32.1

WORKDIR /app

# Copy workspace manifests first — Docker layer-cache friendly
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json    ./packages/api/
COPY packages/web/package.json    ./packages/web/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

# ──────────────────────────────────────────────────────────────────
# Stage 2 — build the React / Vite frontend
# ──────────────────────────────────────────────────────────────────
FROM deps AS builder

COPY . .

RUN pnpm --filter @golden-crm/web build

# ──────────────────────────────────────────────────────────────────
# Stage 3 — lean production image
# ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS production

RUN npm install -g pnpm@10.32.1

# Non-root user for security
RUN addgroup -S golden && adduser -S golden -G golden

WORKDIR /app

# Workspace manifests (pnpm needs these to link workspace packages)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json    ./packages/api/
COPY packages/web/package.json    ./packages/web/
COPY packages/shared/package.json ./packages/shared/

# Install production deps only (devDeps excluded; workspace symlinks kept)
RUN pnpm install --frozen-lockfile --prod && pnpm store prune

# API source + shared types
COPY packages/api    ./packages/api
COPY packages/shared ./packages/shared

# SQL migrations
COPY migrations ./migrations

# Built frontend from Stage 2
COPY --from=builder /app/packages/web/dist ./packages/web/dist

# Uploads volume mount point
RUN mkdir -p /app/uploads && chown -R golden:golden /app

USER golden

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "./node_modules/tsx/dist/cli.mjs", "packages/api/index.ts"]
