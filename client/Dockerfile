# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 ddns && \
    adduser -D -u 1001 -G ddns ddns

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy static files
COPY --from=builder /app/src/server/public ./dist/server/public

# Create data directory
RUN mkdir -p /data && chown ddns:ddns /data

# Switch to non-root user
USER ddns

# Environment defaults
ENV NODE_ENV=production \
    DATA_DIR=/data \
    SERVER_PORT=8080 \
    SERVER_HOST=0.0.0.0 \
    CHECK_INTERVAL=300 \
    IP_VERSION=4 \
    IP_PROVIDERS=all \
    LOG_LEVEL=info

# Expose web UI port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/api/health || exit 1

# Volume for persistent data
VOLUME ["/data"]

# Use dumb-init as entrypoint for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Run the application
CMD ["node", "dist/index.js"]

# Labels
LABEL org.opencontainers.image.source="https://github.com/allecsro/cloudflare-ddns" \
      org.opencontainers.image.title="Cloudflare DDNS Client" \
      org.opencontainers.image.description="Dynamic DNS client with Web UI for Cloudflare Workers" \
      org.opencontainers.image.licenses="MIT"
