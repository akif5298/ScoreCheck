// Validate environment before anything else loads (fails fast on misconfig).
import { env } from '@/config/env';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

import logger from '@/utils/logger';
import { pgPool } from '@/services/supabase';
import { prisma } from '@/services/database';

// Import routes
import authRoutes from '@/routes/auth';
import screenshotRoutes from '@/routes/screenshots';
import analyticsRoutes from '@/routes/analytics';
import adminRoutes from '@/routes/admin';
import mappingsRouter from '@/routes/mappings';

const app = express();
const PORT = env.PORT;

// Render (and most PaaS) terminate TLS at a proxy; trust the first hop so
// express-rate-limit and req.ip see the real client, not the proxy address.
app.set('trust proxy', 1);

// Client SPA build (TanStack Start SPA mode → client/dist/client, with
// _shell.html as the prerendered app shell).
const clientBuildPath = path.join(__dirname, '../../client/dist/client');
const clientShellPath = path.join(clientBuildPath, '_shell.html');
const clientBuildExists = fs.existsSync(clientShellPath);

// The shell contains inline scripts (TanStack Start's hydration bootstrap);
// script-src 'self' alone blocks them and the app renders blank. Allow them
// by hash so CSP stays strict without 'unsafe-inline'.
const inlineScriptHashes: string[] = [];
if (clientBuildExists) {
  const shellHtml = fs.readFileSync(clientShellPath, 'utf8');
  for (const [, body] of shellHtml.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    if (body) {
      // Browsers hash the parsed script text, where the HTML tokenizer has
      // replaced NUL bytes with U+FFFD — mirror that or the hash won't match.
      const parsedText = body.split('\u0000').join('\uFFFD');
      const hash = crypto.createHash('sha256').update(parsedText, 'utf8').digest('base64');
      inlineScriptHashes.push(`'sha256-${hash}'`);
    }
  }
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      scriptSrc: ["'self'", ...inlineScriptHashes],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
}));

// Disable caching globally for API responses
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// CORS configuration. In production the client is served same-origin, so no
// cross-origin access is needed unless CORS_ORIGIN is set (comma-separated).
app.use(cors({
  origin: env.isProduction
    ? (env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? [])
    : ['http://localhost:3000', 'http://localhost:8080'],
  credentials: true,
}));

// Compression middleware
app.use(compression());

// Request logging via pino (structured, correlated with the app logger)
app.use(pinoHttp({ logger }));

// Rate limiting
const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS ?? 900000, // 15 minutes
  max: env.RATE_LIMIT_MAX_REQUESTS ?? 100, // limit each IP to N requests per window
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
  },
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving
app.use('/uploads', express.static(path.join(__dirname, '../../uploads'), {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  },
}));

// Serve the client SPA build
if (clientBuildExists) {
  app.use(express.static(clientBuildPath));
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'ScoreCheck API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/screenshots', screenshotRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/mappings', mappingsRouter);

// Serve the SPA shell for all non-API routes when a client build exists
if (clientBuildExists) {
  app.get('*', (req, res) => {
    // Don't serve the SPA shell for API routes
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({
        success: false,
        error: 'Route not found',
      });
    }
    return res.sendFile(clientShellPath);
  });
} else {
  // 404 handler for development (when React dev server is separate)
  app.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      error: 'Route not found',
    });
  });
}

// Global error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err: error }, 'Unhandled request error');

  // Handle multer errors
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      error: 'File too large. Maximum size is 10MB.',
    });
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      error: 'Unexpected file field.',
    });
  }

  // Handle validation errors
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: error.message,
    });
  }

  // Handle Prisma errors
  if (error.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: 'Duplicate entry',
    });
  }

  // Default error response
  return res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message,
  });
});

// Start server
const server = app.listen(PORT, () => {
  logger.info({ port: PORT, env: env.NODE_ENV }, 'ScoreCheck server started');
});

// Graceful shutdown: stop accepting connections, drain in-flight requests,
// then close DB handles. Force-exit if draining stalls.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down gracefully');

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async () => {
    try {
      await pgPool.end();
      await prisma.$disconnect();
    } catch (err) {
      logger.error({ err }, 'Error closing database connections during shutdown');
    } finally {
      clearTimeout(forceExit);
      process.exit(0);
    }
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export default app;

