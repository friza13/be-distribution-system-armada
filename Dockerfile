# ==============================================================================
# Multi-Stage Production Dockerfile for DMS Backend API
# ==============================================================================

# Stage 1: Build Image
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies including devDependencies for build
RUN npm ci

# Copy application source code
COPY . .

# Build production distribution
RUN npx prisma generate
RUN npm run build

# Prune devDependencies for production runtime
RUN npm prune --production

# ==============================================================================
# Stage 2: Production Runtime Image
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install openssl for Prisma & PostgreSQL clients
RUN apk add --no-allowed-repositories --no-cache openssl bash postgresql-client

# Copy node_modules, Prisma client, and built JS bundle from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./

# Create persistent storage directories
RUN mkdir -p /app/storage/private/pod /app/backups && chown -R node:node /app

# Security: Run application container as non-root user
USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/v1/health/liveness || exit 1

CMD ["node", "dist/main"]
