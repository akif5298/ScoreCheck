/**
 * Unit tests for the typed error classes.
 *
 * These look trivial, and the assertions mostly are — but the properties they pin are the
 * ones callers actually branch on. `name` is compared as a string in a few places, `status`
 * is read off NotFoundError by the mappings routes, and `instanceof` narrowing only works
 * if the prototype chain survives transpilation (it silently does not when a class extends
 * a built-in under some TS/target combinations, which is exactly the sort of breakage that
 * turns a 404 into a 500 with no other symptom).
 */
import {
  DatabaseError,
  OllamaError,
  ExtractionUnavailableError,
  PreprocessorError,
  ValidationError,
  AuthenticationError,
  NotFoundError,
} from '@/errors';

describe('every error class behaves like an Error', () => {
  const instances: Array<[string, Error]> = [
    ['DatabaseError', new DatabaseError('boom')],
    ['OllamaError', new OllamaError('boom')],
    ['ExtractionUnavailableError', new ExtractionUnavailableError()],
    ['PreprocessorError', new PreprocessorError('boom')],
    ['ValidationError', new ValidationError('boom')],
    ['AuthenticationError', new AuthenticationError()],
    ['NotFoundError', new NotFoundError()],
  ];

  it.each(instances)('%s is an instanceof Error', (_name, err) => {
    expect(err).toBeInstanceOf(Error);
  });

  it.each(instances)('%s sets .name to its own class name', (name, err) => {
    // Not cosmetic: logs and a few call sites match on this string.
    expect(err.name).toBe(name);
  });

  it.each(instances)('%s produces a usable stack', (_name, err) => {
    expect(typeof err.stack).toBe('string');
    expect(err.stack!.length).toBeGreaterThan(0);
  });

  it.each(instances)('%s survives being thrown and caught by its own type', (_name, err) => {
    // The prototype-chain check that makes `catch (e) { if (e instanceof X) }` safe.
    expect(() => {
      throw err;
    }).toThrow(err.constructor as new () => Error);
  });
});

describe('DatabaseError', () => {
  it('keeps the message and the optional driver code', () => {
    const err = new DatabaseError('duplicate key', '23505');
    expect(err.message).toBe('duplicate key');
    expect(err.code).toBe('23505');
  });

  it('leaves code undefined when not supplied', () => {
    expect(new DatabaseError('no code').code).toBeUndefined();
  });
});

describe('OllamaError', () => {
  it('carries the raw model output and the HTTP status', () => {
    // rawOutput is what makes a bad-JSON extraction debuggable after the fact.
    const err = new OllamaError('bad json', '{"partial":', 502);
    expect(err.message).toBe('bad json');
    expect(err.rawOutput).toBe('{"partial":');
    expect(err.statusCode).toBe(502);
  });

  it('defaults rawOutput to an empty string, not undefined', () => {
    const err = new OllamaError('failed');
    expect(err.rawOutput).toBe('');
    expect(err.statusCode).toBeUndefined();
  });
});

describe('ExtractionUnavailableError', () => {
  it('has a default message, since callers usually throw it bare', () => {
    expect(new ExtractionUnavailableError().message).toBe('Extraction service unavailable');
  });

  it('accepts an override and an underlying cause', () => {
    const cause = new Error('ECONNREFUSED');
    const err = new ExtractionUnavailableError('host asleep', cause);
    expect(err.message).toBe('host asleep');
    expect(err.cause).toBe(cause);
  });

  it('leaves cause undefined when not supplied', () => {
    expect(new ExtractionUnavailableError().cause).toBeUndefined();
  });

  it('is distinguishable from OllamaError', () => {
    // The two mean different things: unreachable host (503) vs reachable host returning
    // unusable output (500). Conflating them would hide a down host behind a parse error.
    expect(new ExtractionUnavailableError()).not.toBeInstanceOf(OllamaError);
    expect(new OllamaError('x')).not.toBeInstanceOf(ExtractionUnavailableError);
  });
});

describe('PreprocessorError', () => {
  it('carries stderr and the exit code', () => {
    const err = new PreprocessorError('crashed', 'Traceback...', 1);
    expect(err.stderr).toBe('Traceback...');
    expect(err.exitCode).toBe(1);
  });

  it('defaults stderr to an empty string', () => {
    const err = new PreprocessorError('crashed');
    expect(err.stderr).toBe('');
    expect(err.exitCode).toBeUndefined();
  });

  it('treats exit code 0 as a real value rather than falling back', () => {
    // A `|| undefined` style default would erase this; the constructor must pass it through.
    expect(new PreprocessorError('odd', '', 0).exitCode).toBe(0);
  });
});

describe('ValidationError', () => {
  it('names the offending field when given one', () => {
    const err = new ValidationError('must be a number', 'points');
    expect(err.field).toBe('points');
  });

  it('leaves field undefined when not supplied', () => {
    expect(new ValidationError('bad input').field).toBeUndefined();
  });
});

describe('AuthenticationError', () => {
  it('defaults to a message that does not leak which check failed', () => {
    // Login deliberately returns a uniform failure; the default message matches that.
    expect(new AuthenticationError().message).toBe('Authentication failed');
  });

  it('accepts an override', () => {
    expect(new AuthenticationError('token expired').message).toBe('token expired');
  });
});

describe('NotFoundError', () => {
  it('carries status 404 so routes can translate it without a cast', () => {
    expect(new NotFoundError().status).toBe(404);
  });

  it('has a default message and accepts an override', () => {
    expect(new NotFoundError().message).toBe('Not found');
    expect(new NotFoundError('Mapping not found').message).toBe('Mapping not found');
  });

  it('reports 404 on every instance regardless of message', () => {
    expect(new NotFoundError('anything').status).toBe(404);
  });

  it('is narrowable from a catch block', () => {
    // This is the property that replaced `Object.assign(new Error(), { status: 404 })`:
    // the old shape could not be narrowed, so callers reached into an untyped `.status`.
    let narrowed: number | undefined;
    try {
      throw new NotFoundError('Mapping not found');
    } catch (err) {
      if (err instanceof NotFoundError) narrowed = err.status;
    }
    expect(narrowed).toBe(404);
  });
});
