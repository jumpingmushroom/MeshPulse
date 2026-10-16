FROM node:24-bookworm-slim AS build
WORKDIR /app
# Build tools are only needed if better-sqlite3 has no prebuilt binary.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/meshpulse.db PROTOCOL_HEADER=x-forwarded-proto
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./
COPY --from=build /app/scripts/default-proto.mjs /app/scripts/docker-entrypoint.sh ./scripts/
RUN mkdir /data
# Starts as root only to chown /data, then runs as PUID:PGID (default 99:100, Unraid's nobody:users).
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
VOLUME /data
EXPOSE 3000
# Rules first run after 60 s, so /api/health needs about that long to turn 200.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node","--import","./scripts/default-proto.mjs","build"]
