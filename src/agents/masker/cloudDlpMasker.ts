import { DlpServiceClient } from '@google-cloud/dlp';
import type { protos } from '@google-cloud/dlp';
import type {
  MaskedSpan,
  MaskedSpanType,
  MaskingInput,
  MaskingResult,
} from './maskingSchema';

type DlpFinding = protos.google.privacy.dlp.v2.IFinding;
type DlpByteRange = protos.google.privacy.dlp.v2.IRange;
type DlpInspectRequest = protos.google.privacy.dlp.v2.IInspectContentRequest;
type DlpInspectResponse = protos.google.privacy.dlp.v2.IInspectContentResponse;
type DlpDeidentifyRequest =
  protos.google.privacy.dlp.v2.IDeidentifyContentRequest;
type DlpDeidentifyResponse =
  protos.google.privacy.dlp.v2.IDeidentifyContentResponse;

export type CloudDlpClient = {
  inspectContent(request: DlpInspectRequest): Promise<[DlpInspectResponse]>;
  deidentifyContent(
    request: DlpDeidentifyRequest
  ): Promise<[DlpDeidentifyResponse]>;
};

export type CloudDlpMaskerOptions = {
  client?: CloudDlpClient;
  projectId?: string;
  location?: string;
};

export const CLOUD_DLP_RULE_SET_VERSION = 'dlp-ruleset-2026-06-12-v1';
export const CLOUD_DLP_MIN_LIKELIHOOD = 'POSSIBLE' as const;

const DLP_INFO_TYPES = [
  'EMAIL_ADDRESS',
  'PHONE_NUMBER',
  'PERSON_NAME',
  'LOCATION',
  'STREET_ADDRESS',
  'DATE_OF_BIRTH',
  'CREDIT_CARD_NUMBER',
  'JAPAN_INDIVIDUAL_NUMBER',
  'JAPAN_BANK_ACCOUNT',
] as const;

const CUSTOM_DLP_INFO_TYPES = [
  {
    name: 'AIKH_SYNTHETIC_MASKED_PERSON_NAME',
    pattern: String.raw`\bX{2,}\s+[A-Z][a-z]+\b`,
    spanType: 'PERSON_NAME',
  },
  {
    name: 'AIKH_JP_MYNUMBER_LIKE',
    pattern: String.raw`(?:\b\d{12}\b|\b\d{4}-\d{4}-\d{4}\b)`,
    spanType: 'JP_MYNUMBER',
  },
] as const satisfies readonly {
  name: string;
  pattern: string;
  spanType: MaskedSpanType;
}[];

const INFO_TYPE_TO_SPAN_TYPE: Record<string, MaskedSpanType> = {
  EMAIL_ADDRESS: 'EMAIL',
  PHONE_NUMBER: 'PHONE',
  PERSON_NAME: 'PERSON_NAME',
  LOCATION: 'LOCATION',
  STREET_ADDRESS: 'STREET_ADDRESS',
  DATE_OF_BIRTH: 'DATE_OF_BIRTH',
  CREDIT_CARD_NUMBER: 'CREDIT_CARD_NUMBER',
  JAPAN_INDIVIDUAL_NUMBER: 'JP_MYNUMBER',
  JAPAN_BANK_ACCOUNT: 'BANK_ACCOUNT',
  ...Object.fromEntries(
    CUSTOM_DLP_INFO_TYPES.map((infoType) => [
      infoType.name,
      infoType.spanType,
    ])
  ),
};

function createCloudDlpClient(sdkClient: DlpServiceClient): CloudDlpClient {
  return {
    async inspectContent(request) {
      const [response] = await sdkClient.inspectContent(request);
      return [response];
    },
    async deidentifyContent(request) {
      const [response] = await sdkClient.deidentifyContent(request);
      return [response];
    },
  };
}

function replacementTokenForInfoType(infoType: string): string {
  return `[REDACTED:${infoType}]`;
}

function coerceOffset(
  value: DlpByteRange['start'] | DlpByteRange['end'] | undefined
): number | null {
  if (value === null || value === undefined) return null;
  const n =
    typeof value === 'object' ? Number(value.toString()) : Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function byteOffsetToStringIndex(content: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0;
  let bytes = 0;
  for (let index = 0; index < content.length; index += 1) {
    const next = bytes + Buffer.byteLength(content[index], 'utf8');
    if (next > byteOffset) return index;
    bytes = next;
  }
  return content.length;
}

function findingToSpan(content: string, finding: DlpFinding): MaskedSpan | null {
  const infoType = finding.infoType?.name;
  if (!infoType) return null;

  const byteRange = finding.location?.byteRange;
  const startByte = coerceOffset(byteRange?.start);
  const endByte = coerceOffset(byteRange?.end);
  if (startByte === null || endByte === null || endByte <= startByte) {
    return null;
  }

  const start = byteOffsetToStringIndex(content, startByte);
  const end = byteOffsetToStringIndex(content, endByte);
  if (end <= start) return null;

  return {
    start,
    end,
    type: INFO_TYPE_TO_SPAN_TYPE[infoType] ?? 'CUSTOM_RULE',
    ruleId: `dlp:${infoType}`,
  };
}

function buildRuleHits(maskedSpans: MaskedSpan[]): Record<string, number> {
  const hits: Record<string, number> = {};
  for (const span of maskedSpans) {
    hits[span.ruleId] = (hits[span.ruleId] ?? 0) + 1;
  }
  return hits;
}

export async function applyCloudDlpMask(
  input: MaskingInput,
  options: CloudDlpMaskerOptions = {}
): Promise<MaskingResult> {
  const projectId = options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId?.trim()) {
    throw new Error('GOOGLE_CLOUD_PROJECT is required for cloud-dlp masking.');
  }

  const location = options.location ?? process.env.GOOGLE_CLOUD_LOCATION ?? 'global';
  const parent = `projects/${projectId}/locations/${location}`;
  const infoTypes = DLP_INFO_TYPES.map((name) => ({ name }));
  const transformationInfoTypes = [
    ...infoTypes,
    ...CUSTOM_DLP_INFO_TYPES.map((infoType) => ({ name: infoType.name })),
  ];
  const customInfoTypes = CUSTOM_DLP_INFO_TYPES.map((infoType) => ({
    infoType: { name: infoType.name },
    likelihood: CLOUD_DLP_MIN_LIKELIHOOD,
    regex: { pattern: infoType.pattern },
  }));
  const client = options.client ?? createCloudDlpClient(new DlpServiceClient());
  const item = { value: input.content };
  const inspectConfig = {
    infoTypes,
    customInfoTypes,
    minLikelihood: CLOUD_DLP_MIN_LIKELIHOOD,
    includeQuote: false,
  };

  const [inspectResponse] = await client.inspectContent({
    parent,
    inspectConfig,
    item,
  });

  const findings =
    (inspectResponse.result?.findings as DlpFinding[] | undefined) ?? [];
  const maskedSpans = findings
    .map((finding) => findingToSpan(input.content, finding))
    .filter((span): span is MaskedSpan => span !== null)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const [deidentifyResponse] = await client.deidentifyContent({
    parent,
    inspectConfig,
    deidentifyConfig: {
      infoTypeTransformations: {
        transformations: transformationInfoTypes.map(({ name }) => ({
          infoTypes: [{ name }],
          primitiveTransformation: {
            replaceConfig: {
              newValue: {
                stringValue: replacementTokenForInfoType(name),
              },
            },
          },
        })),
      },
    },
    item,
  });

  return {
    provider: 'cloud-dlp',
    maskedContent: deidentifyResponse.item?.value ?? input.content,
    maskedSpans,
    ruleHits: buildRuleHits(maskedSpans),
    ruleSetVersion: CLOUD_DLP_RULE_SET_VERSION,
  };
}
