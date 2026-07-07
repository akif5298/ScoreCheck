import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino/file',
      options: { destination: 1 }, // stdout
    },
  }),
  redact: {
    paths: [
      'req.headers.authorization',
      'body.identityToken',
      'body.authorizationCode',
      '*.privateKey',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
});

export default logger;
