FROM node:20-slim

# Install dependencies required by Puppeteer's bundled Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    libxss1 \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# Do NOT set PUPPETEER_SKIP_DOWNLOAD - let Puppeteer download its own Chromium
# Do NOT set PUPPETEER_EXECUTABLE_PATH - Puppeteer will find its own binary

WORKDIR /app

COPY package.json package-lock.json ./
# Use npm ci without --omit=dev to ensure puppeteer's postinstall runs (downloads Chromium)
RUN npm ci

COPY . .

VOLUME ["/app/.wwebjs_auth", "/app/.wwebjs_cache"]

EXPOSE 3000

CMD ["node", "index.js"]
