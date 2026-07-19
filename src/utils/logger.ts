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
      'req.headers.cookie',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.passwordHash',
      'body.password',
      'body.currentPassword',
      'body.newPassword',
      '*.privateKey',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
});

export default logger;
