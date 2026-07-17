# Node 22 to match CI and Vite/TanStack Start requirements
FROM node:22

# Native-module build deps (canvas needs cairo/pango; Prisma needs OpenSSL)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    libpng-dev \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install server deps first (layer-cached until package files change)
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Install client deps
COPY client/package*.json ./client/
RUN cd client && npm ci

# Copy source and build
COPY . .
RUN npx prisma generate
RUN npm run build:api
RUN cd client && npm run build

# Slim the image: drop dev deps and client build tooling
RUN npm prune --omit=dev && rm -rf client/node_modules

RUN mkdir -p uploads

ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "start"]
