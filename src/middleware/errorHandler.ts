import { Request, Response, NextFunction } from 'express';
import logger from '@/utils/logger';
import { MAX_FILE_SIZE_BYTES } from '@/constants';

export interface MappedError {
  status: number;
  body: { success: false; error: string };
}

const MAX_FILE_SIZE_MB = Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024));

/** Reads a usable HTTP status off an error, whichever spelling the thrower used. */
function statusOf(err: { status?: unknown; statusCode?: unknown }): number | null {
  for (const candidate of [err.status, err.statusCode]) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 400 && candidate <= 599) {
      return candidate;
    }
  }
  return null;
}

/**
 * Maps a thrown error onto an HTTP response.
 *
 * Pure and exported because reaching most of these branches through the running app is
 * impossible: no route forwards to next(), so only body-parser and multer errors ever
 * arrive. Testing the mapping directly is the difference between a branch that is verified
 * and one that merely looks right.
 *
 * `exposeMessage` is false in production, where an error message can carry a query
 * fragment, a file path, or a connection string.
 */
export function toErrorResponse(error: unknown, opts: { exposeMessage: boolean }): MappedError {
  const err = (error ?? {}) as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
  };

  // multer reports its limits by code and never sets a status.
  if (err.code === 'LIMIT_FILE_SIZE') {
    return {
      status: 400,
      body: { success: false, error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.` },
    };
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return { status: 400, body: { success: false, error: 'Unexpected file field.' } };
  }

  // Prisma unique-constraint violation.
  if (err.code === 'P2002') {
    return { status: 409, body: { success: false, error: 'Duplicate entry' } };
  }

  // Anything carrying its own status: body-parser's malformed- and oversized-body errors,
  // and this codebase's typed errors (NotFoundError, ValidationError, SquadError). Ignoring
  // it — as this handler used to — turned a client's malformed JSON into a 500 that blamed
  // the server for the caller's mistake.
  const status = statusOf(err);
  if (status !== null) {
    // A 4xx message describes what the caller sent, so it is safe to return even in
    // production; a 5xx message describes the server, so it follows the same rule as below.
    const expose = status < 500 || opts.exposeMessage;
    return {
      status,
      body: {
        success: false,
        error: expose ? String(err.message ?? 'Request failed') : 'Internal server error',
      },
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      error: opts.exposeMessage ? String(err.message ?? 'Internal server error') : 'Internal server error',
    },
  };
}

/**
 * The app's last-resort error handler.
 *
 * Express recognises an error handler by its arity, so all four parameters must stay in
 * the signature even though `next` is unused.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error({ err: error }, 'Unhandled request error');

  const { status, body } = toErrorResponse(error, {
    // Read at request time rather than from the validated env, so a process that boots in
    // one mode and is inspected in another still reports honestly.
    exposeMessage: process.env.NODE_ENV !== 'production',
  });

  res.status(status).json(body);
}
