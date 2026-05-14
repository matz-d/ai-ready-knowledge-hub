import { beforeAll, describe, expect, it } from 'vitest';
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from 'jose';
import {
  IAP_JWT_ASSERTION_HEADER,
  IAP_JWT_ISSUER,
  verifyIapJwt,
} from '../verifyIapJwt';

const IAP_AUDIENCE =
  '/projects/123456789012/locations/asia-northeast1/services/ai-ready-knowledge-hub';

let signingKey: CryptoKey;
let mismatchedSigningKey: CryptoKey;
let localJwkSet: ReturnType<typeof createLocalJWKSet>;

async function signAssertion(params: {
  audience: string;
  privateKey: CryptoKey;
  email?: string;
  expirationTime: number;
}) {
  return new SignJWT(
    params.email
      ? {
          email: params.email,
        }
      : {}
  )
    .setProtectedHeader({
      alg: 'RS256',
      kid: 'test-key-1',
    })
    .setIssuer(IAP_JWT_ISSUER)
    .setAudience(params.audience)
    .setIssuedAt()
    .setExpirationTime(params.expirationTime)
    .sign(params.privateKey);
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.alg = 'RS256';
  jwk.kid = 'test-key-1';
  jwk.use = 'sig';

  localJwkSet = createLocalJWKSet({
    keys: [jwk],
  });
  signingKey = privateKey;

  const mismatchedKeyPair = await generateKeyPair('RS256');
  mismatchedSigningKey = mismatchedKeyPair.privateKey;
});

describe('verifyIapJwt', () => {
  it('extracts email from a valid assertion', async () => {
    const now = Math.floor(Date.now() / 1000);
    const assertion = await signAssertion({
      audience: IAP_AUDIENCE,
      privateKey: signingKey,
      email: 'Owner@Example.COM',
      expirationTime: now + 300,
    });
    const headers = new Headers({
      [IAP_JWT_ASSERTION_HEADER]: assertion,
    });

    const result = await verifyIapJwt(headers, {
      authMode: 'iap',
      audience: IAP_AUDIENCE,
      jwkSet: localJwkSet,
    });

    expect(result.status).toBe('verified');
    if (result.status === 'verified') {
      expect(result.email).toBe('owner@example.com');
    }
  });

  it('rejects expired assertions', async () => {
    const now = Math.floor(Date.now() / 1000);
    const assertion = await signAssertion({
      audience: IAP_AUDIENCE,
      privateKey: signingKey,
      email: 'alice@example.com',
      expirationTime: now - 10,
    });
    const headers = new Headers({
      [IAP_JWT_ASSERTION_HEADER]: assertion,
    });

    await expect(
      verifyIapJwt(headers, {
        authMode: 'iap',
        audience: IAP_AUDIENCE,
        jwkSet: localJwkSet,
      })
    ).rejects.toThrow();
  });

  it('rejects when audience does not match', async () => {
    const now = Math.floor(Date.now() / 1000);
    const assertion = await signAssertion({
      audience: IAP_AUDIENCE,
      privateKey: signingKey,
      email: 'alice@example.com',
      expirationTime: now + 300,
    });
    const headers = new Headers({
      [IAP_JWT_ASSERTION_HEADER]: assertion,
    });

    await expect(
      verifyIapJwt(headers, {
        authMode: 'iap',
        audience:
          '/projects/123456789012/locations/asia-northeast1/services/another-service',
        jwkSet: localJwkSet,
      })
    ).rejects.toThrow();
  });

  it('rejects when signature does not match', async () => {
    const now = Math.floor(Date.now() / 1000);
    const assertion = await signAssertion({
      audience: IAP_AUDIENCE,
      privateKey: mismatchedSigningKey,
      email: 'alice@example.com',
      expirationTime: now + 300,
    });
    const headers = new Headers({
      [IAP_JWT_ASSERTION_HEADER]: assertion,
    });

    await expect(
      verifyIapJwt(headers, {
        authMode: 'iap',
        audience: IAP_AUDIENCE,
        jwkSet: localJwkSet,
      })
    ).rejects.toThrow();
  });

  it('skips assertion verification in local auth mode', async () => {
    const result = await verifyIapJwt(new Headers(), {
      authMode: 'local',
      audience: IAP_AUDIENCE,
      jwkSet: localJwkSet,
    });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'local-mode',
    });
  });
});
