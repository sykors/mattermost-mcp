FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
USER node
EXPOSE 8000
CMD ["node", "node_modules/supergateway/dist/index.js", "--stdio", "node /app/build/index.js", "--outputTransport", "streamableHttp", "--stateful", "--port", "8000"]
