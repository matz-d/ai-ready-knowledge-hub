import { describe, expect, it, vi } from 'vitest';
import {
  CLOUD_DLP_RULE_SET_VERSION,
  applyCloudDlpMask,
} from '../cloudDlpMasker';

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
            {
              infoType: { name: 'AIKH_JP_MYNUMBER_LIKE' },
              location: { byteRange: { start: 55, end: 69 } },
            },
          ],
        },
      },
    ]);
    const deidentifyContent = vi.fn().mockResolvedValue([
      {
        item: {
          value:
            'email [REDACTED:EMAIL_ADDRESS] / mynumber [REDACTED:JAPAN_INDIVIDUAL_NUMBER] / like [REDACTED:AIKH_JP_MYNUMBER_LIKE]',
        },
      },
    ]);

    const result = await applyCloudDlpMask(
      {
        fileName: 'sample.txt',
        content:
          'email a@example.com / mynumber 123456789012 / like 1234-5678-9012',
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
          minLikelihood: 'POSSIBLE',
          infoTypes: expect.arrayContaining([
            { name: 'EMAIL_ADDRESS' },
            { name: 'JAPAN_INDIVIDUAL_NUMBER' },
            { name: 'JAPAN_BANK_ACCOUNT' },
          ]),
          customInfoTypes: expect.arrayContaining([
            expect.objectContaining({
              infoType: { name: 'AIKH_SYNTHETIC_MASKED_PERSON_NAME' },
              regex: { pattern: String.raw`\bX{2,}\s+[A-Z][a-z]+\b` },
            }),
            expect.objectContaining({
              infoType: { name: 'AIKH_JP_MYNUMBER_LIKE' },
              regex: {
                pattern: String.raw`(?:\b\d{12}\b|\b\d{4}-\d{4}-\d{4}\b)`,
              },
            }),
          ]),
        }),
      })
    );
    expect(deidentifyContent).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: 'projects/test-project/locations/global',
        inspectConfig: expect.objectContaining({
          minLikelihood: 'POSSIBLE',
        }),
        deidentifyConfig: expect.objectContaining({
          infoTypeTransformations: {
            transformations: expect.arrayContaining([
              {
                infoTypes: [{ name: 'EMAIL_ADDRESS' }],
                primitiveTransformation: {
                  replaceConfig: {
                    newValue: {
                      stringValue: '[REDACTED:EMAIL_ADDRESS]',
                    },
                  },
                },
              },
              {
                infoTypes: [{ name: 'JAPAN_INDIVIDUAL_NUMBER' }],
                primitiveTransformation: {
                  replaceConfig: {
                    newValue: {
                      stringValue:
                        '[REDACTED:JAPAN_INDIVIDUAL_NUMBER]',
                    },
                  },
                },
              },
              {
                infoTypes: [{ name: 'AIKH_JP_MYNUMBER_LIKE' }],
                primitiveTransformation: {
                  replaceConfig: {
                    newValue: {
                      stringValue:
                        '[REDACTED:AIKH_JP_MYNUMBER_LIKE]',
                    },
                  },
                },
              },
            ]),
          },
        }),
      })
    );
    expect(result).toEqual({
      provider: 'cloud-dlp',
      maskedContent:
        'email [REDACTED:EMAIL_ADDRESS] / mynumber [REDACTED:JAPAN_INDIVIDUAL_NUMBER] / like [REDACTED:AIKH_JP_MYNUMBER_LIKE]',
      maskedSpans: [
        { start: 6, end: 22, type: 'EMAIL', ruleId: 'dlp:EMAIL_ADDRESS' },
        {
          start: 31,
          end: 43,
          type: 'JP_MYNUMBER',
          ruleId: 'dlp:JAPAN_INDIVIDUAL_NUMBER',
        },
        {
          start: 55,
          end: 65,
          type: 'JP_MYNUMBER',
          ruleId: 'dlp:AIKH_JP_MYNUMBER_LIKE',
        },
      ],
      ruleHits: {
        'dlp:EMAIL_ADDRESS': 1,
        'dlp:JAPAN_INDIVIDUAL_NUMBER': 1,
        'dlp:AIKH_JP_MYNUMBER_LIKE': 1,
      },
      ruleSetVersion: CLOUD_DLP_RULE_SET_VERSION,
    });
  });
});
