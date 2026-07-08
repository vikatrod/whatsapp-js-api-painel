FROM rafola/puppeteer

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY . .

VOLUME ["/app/.wwebjs_auth", "/app/.wwebjs_cache"]

EXPOSE 3000

CMD ["node", "index.js"]