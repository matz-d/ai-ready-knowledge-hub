import { applyCloudDlpMask, type CloudDlpMaskerOptions } from './cloudDlpMasker';
import type { MaskingInput, MaskingProvider, MaskingResult } from './maskingSchema';
import { applySimpleMask } from './simpleMasker';

export type ApplyMaskOptions = {
  provider?: MaskingProvider;
  cloudDlp?: CloudDlpMaskerOptions;
};

export function resolveMaskingProvider(
  provider: MaskingProvider | undefined = process.env.MASKER_PROVIDER as
    | MaskingProvider
    | undefined
): MaskingProvider {
  if (!provider) return 'simple-rule';
  if (provider === 'simple-rule' || provider === 'cloud-dlp') return provider;
  throw new Error(`Unsupported MASKER_PROVIDER: ${provider}`);
}

export async function applyMask(
  input: MaskingInput,
  options: ApplyMaskOptions = {}
): Promise<MaskingResult> {
  const provider = resolveMaskingProvider(options.provider);
  if (provider === 'cloud-dlp') {
    return applyCloudDlpMask(input, options.cloudDlp);
  }
  return applySimpleMask(input);
}
