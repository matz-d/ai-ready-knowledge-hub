import { describe, expect, it, vi } from 'vitest';
import { applyCloudDlpMask } from '../cloudDlpMasker';

describe('applyCloudDlpMask', () => {
  it('uses inspectContent and deidentifyContent with configured infoTypes', async () => {
    const inspectContent = vi.fn().mockResolvedValue([
      {
        result: {
          findings: [
            {
              infoType: { name: 'EMAIL_ADDRESS' },
              location: { byteRange: { start: 6, end: 22 } },
            },
            {
              infoType: { name: 'JAPAN_INDIVIDUAL_NUMBER' },
              location: { byteRange: { start: 31, end: 43 } },
            },
          ],
        },
      },
    ]);
    const deidentifyContent = vi.fn().mockResolvedValue([
      {
        item: {
          value:
            'email EMAIL_ADDRESS / mynumber JAPAN_INDIVIDUAL_NUMBER',
        },
      },
    ]);

    const result = await applyCloudDlpMask(
      {
        fileName: 'sample.txt',
        content: 'email a@example.com / mynumber 123456789012',
        curatorContext: {
          sensitivity: 'Confidential',
          aiUsePolicy: 'requires_masking',
          businessDomain: '顧問契約管理',
        },
      },
      {
        projectId: 'test-project',
        location: 'global',
        client: { inspectContent, deidentifyContent },
      }
    );

    expect(inspectContent).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: 'projects/test-project/locations/global',
        inspectConfig: expect.objectContaining({
          infoTypes: expect.arrayContaining([
            { name: 'EMAIL_ADDRESS' },
            { name: 'JAPAN_INDIVIDUAL_NUMBER' },
            { name: 'JAPAN_BANK_ACCOUNT' },
          ]),
        }),
      })
    );
    expect(deidentifyContent).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: 'projects/test-project/locations/global',
        deidentifyConfig: expect.objectContaining({
          infoTypeTransformations: expect.any(Object),
        }),
      })
    );
    expect(result).toEqual({
      provider: 'cloud-dlp',
      maskedContent:
        'email EMAIL_ADDRESS / mynumber JAPAN_INDIVIDUAL_NUMBER',
      maskedSpans: [
        { start: 6, end: 22, type: 'EMAIL', ruleId: 'dlp:EMAIL_ADDRESS' },
        {
          start: 31,
          end: 43,
          type: 'JP_MYNUMBER',
          ruleId: 'dlp:JAPAN_INDIVIDUAL_NUMBER',
        },
      ],
      ruleHits: {
        'dlp:EMAIL_ADDRESS': 1,
        'dlp:JAPAN_INDIVIDUAL_NUMBER': 1,
      },
    });
  });
});
