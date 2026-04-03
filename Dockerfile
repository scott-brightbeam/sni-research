FROM oven/bun:1.3.9-alpine AS base
WORKDIR /app

# Install API dependencies
COPY web/api/package.json web/api/bun.lock* ./web/api/
RUN cd web/api && bun install --frozen-lockfile --production

# Copy API code
COPY web/api/ ./web/api/

# Copy script libraries used by API routes (draft-parser, dedup originals kept for reference)
# The API now uses its own copies in web/api/lib/

# Copy pre-built frontend (built locally or in CI)
COPY web/app/dist/ ./web/app/dist/

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
