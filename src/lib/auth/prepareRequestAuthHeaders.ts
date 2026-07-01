import type { JWTVerifyGetKey } from 'jose';
import {
  ACTOR_EMAIL_HEADER,
  AUTH_PROVIDER_HEADER,
  IAP_AUTHENTICATED_USER_EMAIL_HEADER,
  TENANT_ID_HEADER,
  resolveTenantIdFromAuth,
} from './resolveTenantIdFromAuth';
import { verifyIapJwt } from './verifyIapJwt';

export type PrepareRequestAuthHeadersOptions = {
  authMode: string;
  iapJwtAudience?: string;
  tenantIdOverride?: string;
  jwkSet?: JWTVerifyGetKey;
};

/**
 * Strips client-supplied identity headers, verifies IAP JWT when required, and
 * attaches trusted tenant/actor headers for downstream route handlers.
 */
export async function prepareRequestAuthHeaders(
  input: Headers,
  options: PrepareRequestAuthHeadersOptions
): Promise<Headers> {
  const authMode = options.authMode.trim().toLowerCase();
  const requestHeaders = new Headers(input);

  requestHeaders.delete(TENANT_ID_HEADER);
  requestHeaders.delete(ACTOR_EMAIL_HEADER);
  requestHeaders.delete(AUTH_PROVIDER_HEADER);
  requestHeaders.delete(IAP_AUTHENTICATED_USER_EMAIL_HEADER);

  const iapVerification = await verifyIapJwt(requestHeaders, {
    authMode,
    audience: options.iapJwtAudience,
    jwkSet: options.jwkSet,
  });

  if (iapVerification.status === 'verified' && iapVerification.email) {
    requestHeaders.set(
      IAP_AUTHENTICATED_USER_EMAIL_HEADER,
      `accounts.google.com:${iapVerification.email}`
    );
  }

  const auth = resolveTenantIdFromAuth(requestHeaders, {
    allowLocalFallback: authMode !== 'iap',
    tenantIdOverride: options.tenantIdOverride,
  });

  requestHeaders.set(TENANT_ID_HEADER, auth.tenantId);
  requestHeaders.set(ACTOR_EMAIL_HEADER, auth.actor.email);
  requestHeaders.set(AUTH_PROVIDER_HEADER, auth.provider);

  return requestHeaders;
}
