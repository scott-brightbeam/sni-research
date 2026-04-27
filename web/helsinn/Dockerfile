FROM oven/bun:1.3.9-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY vite.config.js index.html ./
COPY public ./public
COPY src ./src
RUN bun run build

FROM oven/bun:1.3.9-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY package.json ./
COPY server ./server
# `server/` is already copied wholesale above but keep this comment as a
# reminder: admin-login.html + login.html both live in server/ and ship
# with the image.
EXPOSE 8080
CMD ["bun", "server/server.js"]
