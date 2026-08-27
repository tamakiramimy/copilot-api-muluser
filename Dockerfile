ARG BUN_VERSION=1.3.14

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-alpine AS builder
WORKDIR /app

COPY ./package.json ./bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build
RUN bun install --frozen-lockfile --production --ignore-scripts --no-cache

FROM --platform=$TARGETPLATFORM oven/bun:${BUN_VERSION}-alpine AS runner
WORKDIR /app

# Create non-root user for security
RUN addgroup -S copilot && adduser -S copilot -G copilot

COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create data directory for config persistence
RUN mkdir -p /data && chown -R copilot:copilot /data

# Switch to non-root user
USER copilot

# Environment variables
ENV NODE_ENV=production
ENV PORT=4141
# Config will be stored in /data volume
ENV XDG_DATA_HOME=/data

EXPOSE 4141

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://127.0.0.1:${PORT:-4141}/ || exit 1

COPY --chmod=755 entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
