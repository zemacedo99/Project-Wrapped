# Production image for the app service used by `docker compose up -d --build`
# (the recommended deployment method - see README.md "Quick start").
#
# Keeps devDependencies (including drizzle-kit) in the runtime image on
# purpose: docker-entrypoint.sh runs `drizzle-kit push` on container start to
# apply the current schema before the server starts, so a fresh clone needs
# nothing beyond Docker itself. This trades a larger image for a much simpler,
# more reliable single-command setup - acceptable for this app's size.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/shared ./shared
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 5000
HEALTHCHECK --interval=5s --timeout=5s --retries=20 --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-5000}/api/wrapped" >/dev/null 2>&1 || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]

