FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html support.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node src/sms-notice-catalog.js ./src/sms-notice-catalog.js
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node package.json ./package.json
COPY --from=runtime-deps --chown=node:node /app/node_modules ./node_modules
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV DATA_DIR=/app/data AUTHORITY_ENV_FILE=/app/data/operator.env
EXPOSE 17441
CMD ["node", "server/index.mjs"]
