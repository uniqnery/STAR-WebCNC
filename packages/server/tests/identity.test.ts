import { expect, it } from 'vitest';
import { displayNameOf } from '../src/auth/identity';
import { generateAccessToken, verifyAccessToken } from '../src/auth/jwt';
it('keeps login ID and name distinct in signed identity', () => {
  const payload=verifyAccessToken(generateAccessToken({userId:'user-id',username:'hong01',displayName:'홍길동',role:'USER'}));
  expect(payload).toMatchObject({sub:'user-id',username:'hong01',displayName:'홍길동'});
});
it('preserves legacy accounts with a login-ID fallback', () => {
  expect(displayNameOf({username:'legacy',displayName:''})).toBe('legacy');
  expect(verifyAccessToken(generateAccessToken({userId:'user-id',username:'legacy',role:'USER'}))?.displayName).toBe('legacy');
});
