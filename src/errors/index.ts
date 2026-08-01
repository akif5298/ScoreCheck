/**
 * Typed error classes for each external service boundary.
 * Throw these instead of generic Error objects so callers can handle
 * each service failure independently.
 */

export class DatabaseError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
  }
}

export class OllamaError extends Error {
  readonly statusCode: number | undefined;
  readonly rawOutput: string;
  constructor(message: string, rawOutput = '', statusCode?: number) {
    super(message);
    this.name = 'OllamaError';
    this.rawOutput = rawOutput;
    this.statusCode = statusCode;
  }
}

/**
 * The extraction host (Ollama-compatible endpoint) was unreachable or timed
 * out — as opposed to reachable-but-returned-bad-output (OllamaError). Upload
 * routes translate this into a 503 so the client shows a clean "try again"
 * state instead of a generic 500.
 */
export class ExtractionUnavailableError extends Error {
  readonly cause: unknown;
  constructor(message = 'Extraction service unavailable', cause?: unknown) {
    super(message);
    this.name = 'ExtractionUnavailableError';
    this.cause = cause;
  }
}

export class PreprocessorError extends Error {
  readonly exitCode: number | undefined;
  readonly stderr: string;
  constructor(message: string, stderr = '', exitCode?: number) {
    super(message);
    this.name = 'PreprocessorError';
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

/**
 * The caller sent something the server cannot accept.
 *
 * Carries `status` for the same reason [NotFoundError] does: the global error handler maps
 * any error with a status generically, so one that escapes a route still answers 400
 * instead of a 500 that blames the server for the caller's input.
 */
export class ValidationError extends Error {
  readonly status = 400;
  readonly field: string | undefined;
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class AuthenticationError extends Error {
  constructor(message = 'Authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * A resource the caller asked for is not present in their scope.
 *
 * Carries `status` so a route can translate it without reaching into an untyped error.
 * Replaces the ad-hoc `Object.assign(new Error(...), { status: 404 })` pattern, which
 * produced an error nothing could narrow on and no compiler could check.
 *
 * Note this deliberately covers both "does not exist" and "exists but is not yours": the
 * two are reported identically so a response cannot be used to probe for ids owned by
 * another squad. SquadError in squadService plays the same role for squad-scoped failures
 * and carries an arbitrary status; this is the narrow, common case.
 */
export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * The review step was left too long: the perceptual hash captured at upload time has aged
 * out of the in-memory bridge (services/pendingHashes.ts), so the screenshot has to be
 * uploaded again.
 *
 * 410 rather than 404 or 400: the upload genuinely existed and is genuinely gone, and the
 * caller's request is not malformed. Saving anyway is the alternative this replaces — it
 * stored the game with a null imageHash, leaving that screenshot permanently invisible to
 * duplicate detection without telling anyone.
 *
 * Raised ONLY when the bridge remembers the key timing out. A screenshot it never held
 * (a direct save, or one predating a restart) still saves without a hash, because a
 * timeout cannot be attributed in that case — see TtlMap.status.
 */
export class UploadExpiredError extends Error {
  readonly status = 410;
  constructor(
    message = 'This upload has expired. Please upload the screenshot again to save it.',
  ) {
    super(message);
    this.name = 'UploadExpiredError';
  }
}
