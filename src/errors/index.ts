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

export class ValidationError extends Error {
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
