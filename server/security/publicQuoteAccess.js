import crypto from 'node:crypto';

const hashToken = (value) => crypto
  .createHash('sha256')
  .update(String(value ?? ''))
  .digest('hex');

export const createPublicQuoteAccess = () => {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
};

export const hasValidPublicQuoteAccess = (quote, token) => {
  const expectedHash = String(quote?.publicDocumentTokenHash ?? '').trim();
  const providedToken = String(token ?? '').trim();
  if (!expectedHash || !providedToken) return false;

  try {
    const actual = Buffer.from(hashToken(providedToken), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};
