import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getCredentialsMock = vi.fn();
const driveMock = vi.fn();
const googleAuthConstructorMock = vi.fn();

vi.mock('googleapis', () => {
  class GoogleAuthMock {
    constructor(options: unknown) {
      googleAuthConstructorMock(options);
    }

    getCredentials = getCredentialsMock;
  }

  return {
    google: {
      auth: {
        GoogleAuth: GoogleAuthMock,
      },
      drive: driveMock,
    },
  };
});

describe('googleWorkspaceClient', () => {
  const originalServiceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  });

  afterEach(() => {
    if (originalServiceAccountEmail === undefined) {
      delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    } else {
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = originalServiceAccountEmail;
    }
  });

  it('returns a Drive v3 client scoped to drive.readonly', async () => {
    const driveClient = { files: {} };
    driveMock.mockReturnValue(driveClient);
    const { getGoogleDriveClient } = await import('../googleWorkspaceClient');

    const result = getGoogleDriveClient();

    expect(result).toBe(driveClient);
    expect(googleAuthConstructorMock).toHaveBeenCalledWith({
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    expect(driveMock).toHaveBeenCalledWith({
      version: 'v3',
      auth: expect.any(Object),
    });
  });

  it('gets the service account email from ADC credentials', async () => {
    getCredentialsMock.mockResolvedValue({
      client_email: 'sheet-reader@example.iam.gserviceaccount.com',
    });
    const { getServiceAccountEmail } = await import('../googleWorkspaceClient');

    await expect(getServiceAccountEmail()).resolves.toBe(
      'sheet-reader@example.iam.gserviceaccount.com'
    );
    expect(googleAuthConstructorMock).toHaveBeenCalledWith({
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
  });

  it('falls back to GOOGLE_SERVICE_ACCOUNT_EMAIL when credentials do not include client_email', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL =
      'env-reader@example.iam.gserviceaccount.com';
    getCredentialsMock.mockResolvedValue({});
    const { getServiceAccountEmail } = await import('../googleWorkspaceClient');

    await expect(getServiceAccountEmail()).resolves.toBe(
      'env-reader@example.iam.gserviceaccount.com'
    );
  });
});
