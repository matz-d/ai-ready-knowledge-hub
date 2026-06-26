import { NextResponse } from 'next/server';
import { isDemoMode } from '../../../../../lib/demoMode';
import { getServiceAccountEmail } from '../../../../../lib/googleWorkspaceClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (isDemoMode()) {
    return NextResponse.json({ error: 'demo_mode_disabled' }, { status: 403 });
  }

  try {
    const serviceAccountEmail = await getServiceAccountEmail();
    return NextResponse.json({ serviceAccountEmail });
  } catch (e) {
    console.error(
      '[import/google-sheets/service-account-email] failed to resolve SA email',
      e
    );
    const message =
      e instanceof Error ? e.message : 'Service account email is unavailable.';
    return NextResponse.json(
      {
        code: 'service_account_email_unavailable',
        error: message,
      },
      { status: 503 }
    );
  }
}
