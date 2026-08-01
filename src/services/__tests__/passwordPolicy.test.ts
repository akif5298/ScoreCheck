/**
 * Password policy: breach lookup and the weaknesses a breach corpus misses.
 *
 * The two properties worth guarding hardest are the ones that are easy to get quietly
 * wrong: the plaintext password must never be sent to HIBP (only a 5-char hash prefix),
 * and an unreachable HIBP must ACCEPT rather than reject — failing closed would let a
 * third-party outage block every signup in the app.
 */

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { assessPassword, breachCount, findObviousWeakness } from '@/services/passwordPolicy';

// SHA-1 of 'password' is 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8 — prefix 5BAA6.
const PASSWORD_SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

const realFetch = global.fetch;

function mockRange(body: string, ok = true, status = 200) {
  const fn = jest.fn().mockResolvedValue({
    ok,
    status,
    text: async () => body,
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
});

describe('breachCount', () => {
  it('sends the correct 5-character hash prefix', async () => {
    const fetchMock = mockRange(`${PASSWORD_SUFFIX}:12345`);

    await breachCount('password');

    // Compared on pathname, not the whole URL: the host is pwnedpasswords.com, so a naive
    // "URL must not contain the password" assertion passes/fails on the domain name.
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/range/5BAA6');
  });

  it('never transmits the password itself', async () => {
    const fetchMock = mockRange('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1');
    // A distinctive plaintext that cannot collide with the API host or any header value,
    // so finding it anywhere in the outgoing call is unambiguous evidence of a leak.
    const secret = 'zqx-unique-plaintext-marker-42';

    await breachCount(secret);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toMatch(/^\/range\/[0-9A-F]{5}$/);
    expect(JSON.stringify({ url: new URL(url).pathname, init })).not.toContain(secret);
    expect(init.body).toBeUndefined();
  });

  it('returns the breach count when the suffix is in the range', async () => {
    mockRange(`AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:3\r\n${PASSWORD_SUFFIX}:12345`);

    await expect(breachCount('password')).resolves.toBe(12345);
  });

  it('returns 0 when the suffix is absent from the range', async () => {
    mockRange('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:3');

    await expect(breachCount('password')).resolves.toBe(0);
  });

  it('returns null — not 0 — when the lookup fails', async () => {
    // null means "unknown". Returning 0 would assert the password is clean on no evidence.
    mockRange('', false, 503);
    await expect(breachCount('password')).resolves.toBeNull();

    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as never;
    await expect(breachCount('password')).resolves.toBeNull();
  });
});

describe('findObviousWeakness', () => {
  it('rejects a single repeated character', () => {
    expect(findObviousWeakness('aaaaaaaaaa')).toMatch(/repeated character/i);
  });

  it('rejects long sequential runs in either direction', () => {
    expect(findObviousWeakness('abcdefgh')).toMatch(/sequential/i);
    expect(findObviousWeakness('987654321')).toMatch(/sequential/i);
  });

  it('rejects the site name', () => {
    expect(findObviousWeakness('myScoreCheckPass')).toMatch(/site name/i);
  });

  it('accepts a reasonable password', () => {
    expect(findObviousWeakness('correct-horse-battery')).toBeUndefined();
  });

  it('does not impose composition rules', () => {
    // Deliberate: NIST advises against mandatory symbol/digit/case mixes. An all-lowercase
    // passphrase must pass.
    expect(findObviousWeakness('thequickbrownfoxjumps')).toBeUndefined();
  });
});

describe('assessPassword', () => {
  it('rejects a password found in a breach', async () => {
    mockRange(`${PASSWORD_SUFFIX}:12345`);

    await expect(assessPassword('password')).resolves.toEqual({
      ok: false,
      reason: expect.stringMatching(/known data breach/i),
    });
  });

  it('accepts a password absent from the breach corpus', async () => {
    mockRange('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:3');

    await expect(assessPassword('correct-horse-battery')).resolves.toEqual({ ok: true });
  });

  it('FAILS OPEN when HIBP is unreachable', async () => {
    // The availability call: a third-party outage must not block signups. If this ever
    // flips to rejecting, an HIBP incident becomes a full signup outage.
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as never;

    await expect(assessPassword('correct-horse-battery')).resolves.toEqual({ ok: true });
  });

  it('still rejects an obviously weak password when HIBP is unreachable', async () => {
    // The local check does not depend on the network, so fail-open must not become
    // fail-everything-open.
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as never;

    await expect(assessPassword('aaaaaaaaaa')).resolves.toMatchObject({ ok: false });
  });

  it('does not call HIBP at all when the local check already failed', async () => {
    const fetchMock = mockRange('');

    await assessPassword('abcdefghij');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
