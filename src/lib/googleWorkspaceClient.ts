import { google, type drive_v3 } from 'googleapis';

const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

function createDriveReadonlyAuth() {
  return new google.auth.GoogleAuth({
    scopes: [DRIVE_READONLY_SCOPE],
  });
}

export function getGoogleDriveClient(): drive_v3.Drive {
  const auth = createDriveReadonlyAuth();

  return google.drive({
    version: 'v3',
    auth,
  });
}

export async function getServiceAccountEmail(): Promise<string> {
  const auth = createDriveReadonlyAuth();
  const credentials = await auth.getCredentials();
  const clientEmail = credentials.client_email?.trim();

  if (clientEmail) {
    return clientEmail;
  }

  const envEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  if (envEmail) {
    return envEmail;
  }

  throw new Error(
    'Service account email could not be resolved from ADC credentials. Set GOOGLE_SERVICE_ACCOUNT_EMAIL when running on metadata-server credentials.'
  );
}
