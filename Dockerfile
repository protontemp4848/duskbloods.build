# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

# `docker build --target test .` runs the test suite inside the image.
FROM base AS test
COPY test ./test
RUN npm test

FROM base AS runtime
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "src/server.js"]
