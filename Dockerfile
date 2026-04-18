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

# Copy shared libs that the web API imports across the package boundary.
# web/api/lib/draft-flow.js imports from ../../../scripts/lib/editorial-principles.js
# (the single source of truth for editorial principles, used by both the
# drafting audit here and the upstream Claude-Code-native audit). Only
# scripts/lib/ is needed at runtime — the bash CLIs in scripts/ root are
# Claude-Code-native and never run inside the Fly container.
COPY scripts/lib/ ./scripts/lib/

# Copy built frontend from stage 1
COPY --from=frontend-build /build/web/app/dist/ ./web/app/dist/

# Copy config (read-only in cloud)
COPY config/ ./config/

# Data directory mounted as persistent volume. Fly machines only support ONE
# volume per VM, so drafts (which live in /app/output) are folded into the same
# volume via a symlink created at container startup, after the mount is in place.
VOLUME /app/data

ENV NODE_ENV=production
ENV PORT=3900
EXPOSE 3900

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD bun -e "fetch('http://localhost:3900/api/health').then(r => process.exit(r.ok ? 0 : 1))"

# mkdir is idempotent on the volume; ln -sfn replaces any existing symlink
# (but will fail loudly if a plain directory was left at /app/output — which
# should never happen because nothing in the image build step creates it).
# exec ensures SIGTERM reaches bun directly for graceful shutdown.
CMD ["sh", "-c", "mkdir -p /app/data/output && ln -sfn /app/data/output /app/output && exec bun web/api/server.js"]
