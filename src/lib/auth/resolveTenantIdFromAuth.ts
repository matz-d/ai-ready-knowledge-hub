export const IAP_AUTHENTICATED_USER_EMAIL_HEADER =
  'x-goog-authenticated-user-email';
export const TENANT_ID_HEADER = 'x-knowledge-hub-tenant-id';
export const ACTOR_EMAIL_HEADER = 'x-knowledge-hub-actor-email';
export const AUTH_PROVIDER_HEADER = 'x-knowledge-hub-auth-provider';

export type AuthProvider = 'iap' | 'local-dev';

export type ResolvedAuthContext = {
  tenantId: string;
  provider: AuthProvider;
  actor: {
    userId: string;
    email: string;
  };
};

export class MissingAuthContextError extends Error {
  constructor(message = 'Authenticated user context is missing.') {
    super(message);
    this.name = 'MissingAuthContextError';
  }
}

export class InvalidAuthContextError extends Error {
  constructor(message = 'Authenticated user context is invalid.') {
    super(message);
    this.name = 'InvalidAuthContextError';
  }
}

export type ResolveTenantIdOptions = {
  allowLocalFallback?: boolean;
  tenantIdOverride?: string;
};

function headersFrom(input: Request | Headers): Headers {
  return input instanceof Headers ? input : input.headers;
}

function normalizeTenantId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function tenantIdFromEmail(email: string, tenantIdOverride?: string): string {
  const override = tenantIdOverride?.trim();
  if (override) {
    const normalized = normalizeTenantId(override);
    if (!normalized) {
      throw new InvalidAuthContextError('Configured tenant id is invalid.');
    }
    return normalized;
  }

  const domain = email.split('@')[1]?.trim();
  if (!domain) {
    throw new InvalidAuthContextError('Authenticated email has no domain.');
  }

  const normalized = normalizeTenantId(domain);
  if (!normalized) {
    throw new InvalidAuthContextError('Authenticated email domain is invalid.');
  }
  return normalized;
}

export function normalizeIapAuthenticatedUserEmail(
  headerValue: string | null
): string | null {
  const value = headerValue?.trim();
  if (!value) return null;

  const withoutProvider = value.includes(':')
    ? value.slice(value.lastIndexOf(':') + 1)
    : value;
  const email = withoutProvider.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

export function resolveTenantIdFromAuth(
  input: Request | Headers,
  options: ResolveTenantIdOptions = {}
): ResolvedAuthContext {
  const headers = headersFrom(input);
  const forwardedTenantId = headers.get(TENANT_ID_HEADER);
  const forwardedActorEmail = headers.get(ACTOR_EMAIL_HEADER);
  if (forwardedTenantId && forwardedActorEmail) {
    const email = normalizeIapAuthenticatedUserEmail(forwardedActorEmail);
    const tenantId = normalizeTenantId(forwardedTenantId);
    if (!email || !tenantId) {
      throw new InvalidAuthContextError('Forwarded auth context is invalid.');
    }
    return {
      tenantId,
      provider:
        headers.get(AUTH_PROVIDER_HEADER) === 'local-dev' ? 'local-dev' : 'iap',
      actor: {
        userId: email,
        email,
      },
    };
  }

  const email = normalizeIapAuthenticatedUserEmail(
    headers.get(IAP_AUTHENTICATED_USER_EMAIL_HEADER)
  );
  if (email) {
    return {
      tenantId: tenantIdFromEmail(email, options.tenantIdOverride),
      provider: 'iap',
      actor: {
        userId: email,
        email,
      },
    };
  }

  if (options.allowLocalFallback) {
    const email = 'local-dev@localhost.local';
    return {
      tenantId: tenantIdFromEmail(email, options.tenantIdOverride ?? 'local-dev'),
      provider: 'local-dev',
      actor: {
        userId: email,
        email,
      },
    };
  }

  throw new MissingAuthContextError();
}

