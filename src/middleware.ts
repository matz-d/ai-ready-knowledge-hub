import { NextResponse, type NextRequest } from 'next/server';
import {
  ACTOR_EMAIL_HEADER,
  AUTH_PROVIDER_HEADER,
  MissingAuthContextError,
  TENANT_ID_HEADER,
  resolveTenantIdFromAuth,
} from './lib/auth/resolveTenantIdFromAuth';
import { verifyIapJwt } from './lib/auth/verifyIapJwt';

const AUTH_MODE = process.env.AUTH_MODE?.trim().toLowerCase() ?? 'local';
const TENANT_ID_OVERRIDE = process.env.KNOWLEDGE_HUB_TENANT_ID?.trim();
const IAP_JWT_AUDIENCE = process.env.IAP_JWT_AUDIENCE?.trim();

if (AUTH_MODE === 'iap' && !IAP_JWT_AUDIENCE) {
  console.warn(
    '[auth] AUTH_MODE=iap but IAP_JWT_AUDIENCE is not set. Falling back to trusting IAP headers without JWT assertion verification.'
  );
}

function authIsRequired(): boolean {
  return AUTH_MODE === 'iap';
}

export async function middleware(request: NextRequest) {
  try {
    await verifyIapJwt(request.headers, {
      authMode: AUTH_MODE,
      audience: IAP_JWT_AUDIENCE,
    });

    const auth = resolveTenantIdFromAuth(request.headers, {
      allowLocalFallback: !authIsRequired(),
      tenantIdOverride: TENANT_ID_OVERRIDE,
    });
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(TENANT_ID_HEADER, auth.tenantId);
    requestHeaders.set(ACTOR_EMAIL_HEADER, auth.actor.email);
    requestHeaders.set(AUTH_PROVIDER_HEADER, auth.provider);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    if (error instanceof MissingAuthContextError || authIsRequired()) {
      return NextResponse.json(
        { error: 'authentication_required' },
        { status: 401 }
      );
    }
    throw error;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
