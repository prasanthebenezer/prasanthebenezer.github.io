FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
RUN mkdir -p database certificates
EXPOSE 3000
CMD ["node", "server.js"]
