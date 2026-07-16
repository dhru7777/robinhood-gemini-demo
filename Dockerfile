FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js app.js index.html logo.png config.js ./
COPY render.yaml railway.toml netlify.toml ./
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.js"]
