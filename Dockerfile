FROM node:20-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --omit=dev \
  && npm run prisma:generate \
  && npm cache clean --force

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
  HOME=/home/app
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gosu \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 app \
  && useradd --uid 10001 --gid app --shell /usr/sbin/nologin --create-home app
COPY --chown=app:app --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json package-lock.json prisma.config.ts ./
COPY docker/entrypoint.sh /usr/local/bin/wedding-entrypoint
RUN chmod 0755 /usr/local/bin/wedding-entrypoint \
  && mkdir -p /app/data/media /app/data/tmp \
  && chown -R app:app /app/data
EXPOSE 3000
ENTRYPOINT ["wedding-entrypoint"]
CMD ["node", "dist/server/server.js"]
