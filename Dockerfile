FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
