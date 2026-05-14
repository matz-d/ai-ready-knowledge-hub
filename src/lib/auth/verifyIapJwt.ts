import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import {
  MissingAuthContextError,
  normalizeIapAuthenticatedUserEmail,
} from './resolveTenantIdFromAuth';

export const IAP_JWT_ASSERTION_HEADER = 'x-goog-iap-jwt-assertion';
export const IAP_JWT_ISSUER = 'https://cloud.google.com/iap';
export const IAP_PUBLIC_JWK_URL = new URL(
  'https://www.gstatic.com/iap/verify/public_key-jwk'
);

const iapRemoteJwkSet = createRemoteJWKSet(IAP_PUBLIC_JWK_URL);

export type VerifyIapJwtOptions = {
  authMode: string;
  audience?: string;
  jwkSet?: JWTVerifyGetKey;
};

export type VerifyIapJwtResult =
  | {
      status: 'verified';
      payload: JWTPayload;
      email: string | null;
    }
  | {
      status: 'skipped';
      reason: 'local-mode' | 'audience-missing';
    };

export function shouldVerifyIapJwt(authMode: string, audience?: string): boolean {
  return authMode.trim().toLowerCase() === 'iap' && Boolean(audience?.trim());
}

export async function verifyIapJwt(
  headers: Headers,
  options: VerifyIapJwtOptions
): Promise<VerifyIapJwtResult> {
  const authMode = options.authMode.trim().toLowerCase();
  if (authMode !== 'iap') {
    return {
      status: 'skipped',
      reason: 'local-mode',
    };
  }

  const audience = options.audience?.trim();
  if (!audience) {
    return {
      status: 'skipped',
      reason: 'audience-missing',
    };
  }

  const assertion = headers.get(IAP_JWT_ASSERTION_HEADER)?.trim();
  if (!assertion) {
    throw new MissingAuthContextError('IAP JWT assertion header is missing.');
  }

  const { payload } = await jwtVerify(assertion, options.jwkSet ?? iapRemoteJwkSet, {
    audience,
    issuer: IAP_JWT_ISSUER,
  });

  const email =
    typeof payload.email === 'string'
      ? normalizeIapAuthenticatedUserEmail(payload.email)
      : null;

  return {
    status: 'verified',
    payload,
    email,
  };
}
