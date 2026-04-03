FROM oven/bun:1.3.9-alpine AS base

# --- Stage 1: Build frontend ---
FROM base AS frontend-build
WORKDIR /build
COPY web/app/package.json web/app/bun.lock* ./web/app/
RUN cd web/app && bun install --frozen-lockfile
COPY web/app/ ./web/app/
RUN cd web/app && bun run build

# --- Stage 2: Production image ---
FROM base AS production
WORKDIR /app

# Install API dependencies
COPY web/api/package.json web/api/bun.lock* ./web/api/
RUN cd web/api && bun install --frozen-lockfile --production

# Copy API code
COPY web/api/ ./web/api/

# Copy built frontend from stage 1
COPY --from=frontend-build /build/web/app/dist/ ./web/app/dist/

# Copy config (read-only in cloud)
COPY config/ ./config/

# Data directory mounted as persistent volume
VOLUME /app/data

ENV NODE_ENV=production
ENV PORT=3900
EXPOSE 3900

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD bun -e "fetch('http://localhost:3900/api/health').then(r => process.exit(r.ok ? 0 : 1))"

CMD ["bun", "web/api/server.js"]
