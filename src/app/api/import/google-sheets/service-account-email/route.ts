import { NextResponse } from 'next/server';
import { getServiceAccountEmail } from '../../../../../lib/googleWorkspaceClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
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
