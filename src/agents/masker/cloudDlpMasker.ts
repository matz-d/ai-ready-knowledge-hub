import { DlpServiceClient } from '@google-cloud/dlp';
import type {
  MaskedSpan,
  MaskedSpanType,
  MaskingInput,
  MaskingResult,
} from './maskingSchema';

type DlpByteRange = {
  start?: string | number | null;
  end?: string | number | null;
};

type DlpFinding = {
  infoType?: { name?: string | null } | null;
  location?: {
    byteRange?: DlpByteRange | null;
  } | null;
};

type DlpInspectResponse = {
  result?: {
    findings?: DlpFinding[] | null;
  } | null;
};

type DlpDeidentifyResponse = {
  item?: {
    value?: string | null;
  } | null;
};

export type CloudDlpClient = {
  inspectContent(request: unknown): Promise<[DlpInspectResponse]>;
  deidentifyContent(request: unknown): Promise<[DlpDeidentifyResponse]>;
};

export type CloudDlpMaskerOptions = {
  client?: CloudDlpClient;
  projectId?: string;
  location?: string;
};

export const CLOUD_DLP_RULE_SET_VERSION = 'dlp-ruleset-2026-05-15-v1';
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
};

function replacementTokenForInfoType(infoType: string): string {
  return `[REDACTED:${infoType}]`;
}

function coerceOffset(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number(value) : value;
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
  const client =
    options.client ?? (new DlpServiceClient() as unknown as CloudDlpClient);
  const item = { value: input.content };
  const inspectConfig = {
    infoTypes,
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
        transformations: DLP_INFO_TYPES.map((name) => ({
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
