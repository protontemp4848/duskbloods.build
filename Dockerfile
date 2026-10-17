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

# Downloads the sheet once, at build time; the build fails if it can't. deploy.sh never caches this stage.
FROM base AS sheet
ARG SHEET_ID
COPY scripts/fetch-sheet.js ./scripts/
RUN node scripts/fetch-sheet.js /app/sheet.xlsx

FROM base AS runtime
COPY --from=sheet /app/sheet.xlsx ./sheet.xlsx
ENV NODE_ENV=production PORT=8080 SHEET_FILE=/app/sheet.xlsx
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "src/server.js"]
