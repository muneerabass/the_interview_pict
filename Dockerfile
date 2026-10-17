# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The landing-page prerender and the postbuild sitemap both read Mongo, and
# lib/mongodb.js throws at import without the URI. Mounted as a BuildKit secret
# so it never lands in an image layer.
RUN --mount=type=secret,id=mongodb_uri \
    MONGODB_URI="$(cat /run/secrets/mongodb_uri)" npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
# Owned by node: the landing page's ISR cache is written under .next at runtime.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
CMD ["node", "server.js"]
