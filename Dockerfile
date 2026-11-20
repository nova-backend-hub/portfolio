FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.mjs ./
COPY public ./public
COPY data/portfolio.json ./data/portfolio.json

RUN mkdir -p /app/uploads /app/downloads && chown -R node:node /app

USER node

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.mjs"]
