import { NextResponse, type NextRequest } from 'next/server';
import { MissingAuthContextError } from './lib/auth/resolveTenantIdFromAuth';
import { prepareRequestAuthHeaders } from './lib/auth/prepareRequestAuthHeaders';

const AUTH_MODE = process.env.AUTH_MODE?.trim().toLowerCase() ?? 'local';
const IAP_JWT_AUDIENCE = process.env.IAP_JWT_AUDIENCE?.trim();

if (AUTH_MODE === 'iap' && !IAP_JWT_AUDIENCE) {
  console.warn(
    '[auth] AUTH_MODE=iap but IAP_JWT_AUDIENCE is not set. Requests will fail closed with 401; unsigned identity headers are not trusted.'
  );
}

function authIsRequired(): boolean {
  return AUTH_MODE === 'iap';
}

export async function middleware(request: NextRequest) {
  try {
    const requestHeaders = await prepareRequestAuthHeaders(request.headers, {
      authMode: AUTH_MODE,
      iapJwtAudience: IAP_JWT_AUDIENCE,
      tenantIdOverride: process.env.KNOWLEDGE_HUB_TENANT_ID?.trim(),
    });

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
