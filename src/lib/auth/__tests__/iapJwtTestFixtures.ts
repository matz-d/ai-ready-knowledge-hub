import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
} from 'jose';
import { IAP_JWT_ASSERTION_HEADER, IAP_JWT_ISSUER } from '../verifyIapJwt';

export const IAP_TEST_AUDIENCE =
  '/projects/123456789012/locations/asia-northeast1/services/ai-ready-knowledge-hub';

export type IapJwtTestFixtures = {
  signingKey: CryptoKey;
  localJwkSet: JWTVerifyGetKey;
  signAssertion: (params: {
    audience?: string;
    email?: string;
    expirationTime: number;
  }) => Promise<string>;
};

export async function createIapJwtTestFixtures(): Promise<IapJwtTestFixtures> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.alg = 'RS256';
  jwk.kid = 'test-key-1';
  jwk.use = 'sig';

  const localJwkSet = createLocalJWKSet({
    keys: [jwk],
  });

  async function signAssertion(params: {
    audience?: string;
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
      .setAudience(params.audience ?? IAP_TEST_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(params.expirationTime)
      .sign(privateKey);
  }

  return {
    signingKey: privateKey,
    localJwkSet,
    signAssertion,
  };
}

export async function headersWithIapAssertion(
  fixtures: IapJwtTestFixtures,
  params: {
    email?: string;
    expirationTime?: number;
    extra?: Record<string, string>;
  }
): Promise<Headers> {
  const now = Math.floor(Date.now() / 1000);
  const assertion = await fixtures.signAssertion({
    email: params.email,
    expirationTime: params.expirationTime ?? now + 300,
  });

  return new Headers({
    [IAP_JWT_ASSERTION_HEADER]: assertion,
    ...params.extra,
  });
}
