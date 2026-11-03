# Optional: the proxy also runs directly with `npm start` (Node >= 23.6).
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787
CMD ["node", "src/server.ts"]
