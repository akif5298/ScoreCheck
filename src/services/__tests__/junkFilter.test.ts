import { classifyScreenshot } from '@/services/junkFilter';

const TEST_IMAGE = Buffer.from('fake-image-data');

// Capture the original global.fetch so we can restore it after tests
const originalFetch = global.fetch;

function mockFetchJson(responseText: string): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ response: responseText }),
  } as unknown as Response);
}

function mockFetchHttpError(status: number): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
  } as unknown as Response);
}

function mockFetchNetworkError(error: Error): void {
  global.fetch = jest.fn().mockRejectedValue(error);
}

function mockFetchBadJson(): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.reject(new SyntaxError('Unexpected token')),
  } as unknown as Response);
}

afterAll(() => {
  global.fetch = originalFetch;
});

describe('classifyScreenshot', () => {
  describe('model says yes', () => {
    it('returns isValidBoxScore:true, confidence:high for "yes" response', async () => {
      mockFetchJson('yes');
      const result = await classifyScreenshot(TEST_IMAGE);
      expect(result.isValidBoxScore).toBe(true);
      expect(result.confidence).toBe('high');
      expect(result.reason).toBe('model_yes');
    });

    it('matches "yes" even with trailing text', async () => {
      mockFetchJson('yes, this appears to be a box score');
      const result = await classifyScreenshot(TEST_IMAGE);
      expect(result.isValidBoxScore).toBe(true);
      expect(result.reason).toBe('model_yes');
    });

    it('matches "YES" (case-insensitive)', async () => {
      mockFetchJson('YES');
      const result = await classifyScreenshot(TEST_IMAGE);
      expect(result.isValidBoxScore).toBe(true);
      expect(result.reason).toBe('model_yes');
    });
  });

  describe('model says no', () => {
    it('returns isValidBoxScore:false, confidence:high for "no" response', async () => {
      mockFetchJson('no');
      const result = await classifyScreenshot(TEST_IMAGE);
      expect(result.isValidBoxScore).toBe(false);
      expect(result.confidence).toBe('high');
      expect(result.reason).toBe('model_no');
    });

    it('matches "no" with trailing text', async () => {
      mockFetchJson('no, this is not a box score');
      const result = await classifyScreenshot(TEST_IMAGE);
      expect(result.isValidBoxScore).toBe(false);
      expect(result.reason).toBe('model_no');
    });
  });

  describe('ambiguous model response — fail open', () => {
    it('returns isValidBoxScore:true, confidence:medium for an ambiguous response', async () => {
      mockFetchJson('maybe');
      const result = await classifyScreenshot(TEST_IMAGE);
      expect(result.isValidBoxScore).toBe(true);
      expect(result.confidence).toBe('medium');
      expect(result.reason).toMatch(/^model_ambiguous:/);
    });
  });

  describe('network failure — fail open', () => {
    it('returns isValidBoxScore:true, confidence:low when fetch throws a generic error', async () => {
      mockFetchNetworkError(new Error('ECONNREFUSED'));
      const result = await classifyScreenshot(TEST_IMAGE);
      expect(result.isValidBoxScore).toBe(true);
      expect(result.confidence).toBe('low');
      expect(result.reason).toBe('filter_unavailable');
    });

    it('returns reason:filter_timeout when fetch aborts', async () => {
      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';
      mockFetchNetworkError(abortError);
      const result = await classifyScreenshot(TEST_IMAGE);
      expect(result.isValidBoxScore).toBe(true);
      expect(result.confidence).toBe('low');
      expect(result.reason).toBe('filter_timeout');
    });
  });

  describe('HTTP error — fail open', () => {
    it('returns reason:filter_http_503 when Ollama returns 503', async () => {
      mockFetchHttpError(503);
      const result = await classifyScreenshot(TEST_IMAGE);
      expect(result.isValidBoxScore).toBe(true);
      expect(result.confidence).toBe('low');
      expect(result.reason).toBe('filter_http_503');
    });

    it('returns reason:filter_http_404 when Ollama returns 404', async () => {
      mockFetchHttpError(404);
      const result = await classifyScreenshot(TEST_IMAGE);
      expect(result.isValidBoxScore).toBe(true);
      expect(result.reason).toBe('filter_http_404');
    });
  });

  describe('JSON parse failure — fail open', () => {
    it('returns reason:filter_parse_error when response body is not valid JSON', async () => {
      mockFetchBadJson();
      const result = await classifyScreenshot(TEST_IMAGE);
      expect(result.isValidBoxScore).toBe(true);
      expect(result.confidence).toBe('low');
      expect(result.reason).toBe('filter_parse_error');
    });
  });

  describe('latencyMs', () => {
    it('includes a non-negative latencyMs in every result', async () => {
      mockFetchJson('yes');
      const result = await classifyScreenshot(TEST_IMAGE);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
});
