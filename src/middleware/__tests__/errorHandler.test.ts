/**
 * Unit tests for the global error mapping.
 *
 * Almost none of these branches can be reached through the running app — no route forwards
 * to next(), so only body-parser and multer errors ever arrive at the handler. Testing the
 * mapping directly is what makes the Prisma and typed-error paths verified rather than
 * merely plausible.
 */
import { toErrorResponse, errorHandler } from '@/middleware/errorHandler';
import { MAX_FILE_SIZE_BYTES } from '@/constants';
import { NotFoundError, ValidationError } from '@/errors';

const dev = { exposeMessage: true };
const prod = { exposeMessage: false };

describe('multer limits', () => {
  it('reports the size limit from the configured constant, not a hardcoded number', () => {
    const mb = Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024));

    // The message used to say "10MB" literally, so raising MAX_FILE_SIZE would have left
    // users being told the wrong limit.
    expect(toErrorResponse({ code: 'LIMIT_FILE_SIZE' }, dev)).toEqual({
      status: 400,
      body: { success: false, error: `File too large. Maximum size is ${mb}MB.` },
    });
  });

  it('names an unexpected file field', () => {
    expect(toErrorResponse({ code: 'LIMIT_UNEXPECTED_FILE' }, dev)).toEqual({
      status: 400,
      body: { success: false, error: 'Unexpected file field.' },
    });
  });

  it('keeps the size message in production — it describes the request, not the server', () => {
    expect(toErrorResponse({ code: 'LIMIT_FILE_SIZE' }, prod).body.error).toMatch(/File too large/);
  });
});

describe('Prisma errors', () => {
  it('maps a unique-constraint violation to 409', () => {
    expect(toErrorResponse({ code: 'P2002', message: 'Unique constraint failed' }, dev)).toEqual({
      status: 409,
      body: { success: false, error: 'Duplicate entry' },
    });
  });

  it('does not leak the constraint name', () => {
    // The message names the table and column, which describes the schema to a caller.
    expect(toErrorResponse({ code: 'P2002', message: 'players_gameId_name_team_key' }, dev).body.error)
      .toBe('Duplicate entry');
  });

  it('falls through for other Prisma codes', () => {
    expect(toErrorResponse({ code: 'P2025', message: 'Record not found' }, dev).status).toBe(500);
  });
});

describe('errors carrying their own status', () => {
  it('honours a body-parser malformed-JSON error as 400', () => {
    // This is the fix: the handler used to ignore status entirely, so a caller sending bad
    // JSON was told the server had broken.
    const bodyParserError = Object.assign(new SyntaxError('Unexpected end of JSON input'), {
      status: 400,
      type: 'entity.parse.failed',
    });

    expect(toErrorResponse(bodyParserError, dev)).toEqual({
      status: 400,
      body: { success: false, error: 'Unexpected end of JSON input' },
    });
  });

  it('honours an oversized-body error as 413', () => {
    expect(toErrorResponse({ status: 413, message: 'request entity too large' }, dev).status).toBe(413);
  });

  it('accepts statusCode as well as status', () => {
    // http-errors uses one spelling, several libraries use the other.
    expect(toErrorResponse({ statusCode: 429, message: 'slow down' }, dev)).toEqual({
      status: 429,
      body: { success: false, error: 'slow down' },
    });
  });

  it('prefers status when both are present', () => {
    expect(toErrorResponse({ status: 403, statusCode: 500, message: 'no' }, dev).status).toBe(403);
  });

  it.each([
    ['a NotFoundError', new NotFoundError('Game not found'), 404, 'Game not found'],
    ['a ValidationError', new ValidationError('email is required', 'email'), 400, 'email is required'],
  ])('maps %s by its status', (_label, error, status, message) => {
    // Neither reaches the handler today — every route catches its own — but they will the
    // moment a route forgets, and 400/404 beats a 500 that blames the server.
    expect(toErrorResponse(error, dev)).toEqual({ status, body: { success: false, error: message } });
  });

  it('keeps a 4xx message in production', () => {
    expect(toErrorResponse(new NotFoundError('Game not found'), prod).body.error).toBe('Game not found');
  });

  it('hides a 5xx message in production even when the status was explicit', () => {
    // A 502 from a service wrapper can carry an upstream URL or credential fragment.
    expect(toErrorResponse({ status: 502, message: 'upstream https://user:pw@host failed' }, prod)).toEqual({
      status: 502,
      body: { success: false, error: 'Internal server error' },
    });
  });

  it.each([
    ['below the 4xx floor', 200],
    ['above the 5xx ceiling', 600],
    ['not an integer', 404.5],
    ['a numeric string', '404'],
    ['null', null],
  ])('ignores a status that is %s', (_label, status) => {
    // A stray `status` field on an unrelated object must not become the response code.
    expect(toErrorResponse({ status, message: 'boom' }, dev).status).toBe(500);
  });
});

describe('the default response', () => {
  it('exposes the message outside production', () => {
    expect(toErrorResponse(new Error('connection terminated unexpectedly'), dev)).toEqual({
      status: 500,
      body: { success: false, error: 'connection terminated unexpectedly' },
    });
  });

  it('says nothing specific in production', () => {
    expect(toErrorResponse(new Error('connection terminated unexpectedly'), prod)).toEqual({
      status: 500,
      body: { success: false, error: 'Internal server error' },
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'something broke'],
    ['a number', 42],
  ])('survives %s being thrown instead of an Error', (_label, thrown) => {
    // `throw 'string'` is legal JavaScript, and a handler that crashes on it takes the
    // process down instead of answering the request.
    const mapped = toErrorResponse(thrown, dev);

    expect(mapped.status).toBe(500);
    expect(typeof mapped.body.error).toBe('string');
  });

  it('falls back to a generic message when the error has none', () => {
    expect(toErrorResponse({}, dev).body.error).toBe('Internal server error');
  });
});

describe('the express middleware', () => {
  function fakeRes() {
    const res = {
      statusCode: 0,
      payload: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.payload = body;
        return this;
      },
    };
    return res;
  }

  it('has the four-parameter arity express uses to recognise an error handler', () => {
    // Drop a parameter and express silently treats it as ordinary middleware, so errors
    // stop being handled at all — with no error anywhere to say so.
    expect(errorHandler).toHaveLength(4);
  });

  it('writes the mapped status and body onto the response', () => {
    const res = fakeRes();

    errorHandler({ code: 'LIMIT_UNEXPECTED_FILE' }, {} as never, res as never, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.payload).toEqual({ success: false, error: 'Unexpected file field.' });
  });

  it('reads NODE_ENV at request time', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = fakeRes();

      errorHandler(new Error('internal detail'), {} as never, res as never, jest.fn());

      expect(res.payload).toEqual({ success: false, error: 'Internal server error' });
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('never calls next — the handler is the end of the chain', () => {
    const next = jest.fn();

    errorHandler(new Error('boom'), {} as never, fakeRes() as never, next);

    // Calling next here would hand the error to express's default handler, which replies
    // with an HTML stack trace.
    expect(next).not.toHaveBeenCalled();
  });
});
