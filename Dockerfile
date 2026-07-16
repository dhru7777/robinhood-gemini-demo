FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js app.js index.html logo.png ./
COPY render.yaml railway.toml ./

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.js"]
