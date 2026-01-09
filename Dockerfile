# Use Node.js 18 Alpine as base image
FROM node:18-alpine

# Install Python and build dependencies for native modules (canvas, sharp, etc.)
# Canvas requires: cairo, pango, pixman, pkg-config, and image libraries
# OpenSSL is required for Prisma to work correctly
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    pkgconfig \
    openssl \
    openssl-dev \
    cairo-dev \
    pango-dev \
    pixman-dev \
    libpng-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev

# Set working directory
WORKDIR /app

# Copy package files for root
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including dev dependencies for building)
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build the TypeScript server
RUN npm run build:server

# Build the React client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Back to main directory
WORKDIR /app

# Remove dev dependencies to reduce image size (optional but recommended)
RUN npm prune --production

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 3001

# Start the application
CMD ["npm", "start"]
