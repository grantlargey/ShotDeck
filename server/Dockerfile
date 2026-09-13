FROM node:24.13.1-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 4000

CMD ["node", "src/index.js"]
