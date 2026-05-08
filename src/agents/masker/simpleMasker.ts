import { createHash } from 'node:crypto';
import type { MaskingInput, MaskingResult, MaskedSpan, MaskedSpanType } from './maskingSchema';

type RuleDef = {
  id: string;
  type: MaskedSpanType;
  regex: RegExp;
  /** 指定時は RegExp に `d` フラグが必要。マスク対象はこのキャプチャグループの範囲のみ。 */
  maskGroup?: number;
};

type InternalSpan = {
  start: number;
  end: number;
  type: MaskedSpanType;
  ruleId: string;
};

function selectNonOverlapping(spans: InternalSpan[]): InternalSpan[] {
  const sorted = [...spans].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - b.start - (a.end - a.start);
  });
  const out: InternalSpan[] = [];
  for (const s of sorted) {
    const overlaps = out.some(
      (o) => !(s.end <= o.start || s.start >= o.end)
    );
    if (!overlaps) out.push(s);
  }
  return out.sort((a, b) => a.start - b.start);
}

function collectRuleSpans(content: string, rules: RuleDef[]): InternalSpan[] {
  const spans: InternalSpan[] = [];
  for (const rule of rules) {
    let flags = rule.regex.flags.includes('g')
      ? rule.regex.flags
      : `${rule.regex.flags}g`;
    if (rule.maskGroup !== undefined && !flags.includes('d')) {
      flags += 'd';
    }
    const globalRe = new RegExp(rule.regex.source, flags);
    for (const m of content.matchAll(globalRe)) {
      let start: number;
      let end: number;
      if (rule.maskGroup !== undefined) {
        const idx = m.indices?.[rule.maskGroup];
        if (!idx) continue;
        [start, end] = idx;
      } else {
        if (m.index === undefined) continue;
        start = m.index;
        end = start + m[0].length;
      }
      spans.push({
        start,
        end,
        type: rule.type,
        ruleId: rule.id,
      });
    }
  }
  return spans;
}

/**
 * 決定的なルールベースマスク。LLM は呼ばない。
 * 将来 Cloud DLP 等へ置き換える場合は本関数と同じシグネチャのプロバイダを差し替える。
 */
export function applySimpleMask(input: MaskingInput): MaskingResult {
  const { content } = input;

  const rules: RuleDef[] = [
    {
      id: 'email',
      type: 'EMAIL',
      regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    },
    {
      id: 'phone_like',
      type: 'PHONE',
      regex: /\b\d{2,4}-[\dX]{2,4}-[\dX]{4}\b/gi,
    },
    {
      id: 'postal_hyphen',
      type: 'POSTAL_CODE',
      regex: /〒?\s*\d{3}-\d{4}\b/g,
    },
    {
      id: 'mynumber_12',
      type: 'JP_MYNUMBER',
      regex: /(?<!\d)\d{12}(?!\d)/g,
    },
    {
      id: 'bank_account_full',
      type: 'BANK_ACCOUNT',
      regex:
        /(?:普通|当座)\s*\d{7}(?:[ \u3000]+[\u30A0-\u30FFー\-・]{2,})?|\d{7}[ \u3000]+[\u30A0-\u30FFー\-・]{2,}/g,
    },
    {
      id: 'amount_jpy',
      type: 'AMOUNT_JPY',
      regex:
        /(?:^|[\s「『])(?:月額|金額|額|振込)?\s*([\d,]+円(?:（[^）]*）)?)/dmu,
      maskGroup: 1,
    },
    {
      id: 'label_party',
      type: 'COMPANY_NAME_HINT',
      regex: /(?:甲|乙)[:：]\s*[^\n\r]+/g,
    },
    {
      id: 'label_daihyo_long',
      type: 'PERSON_NAME_HINT',
      regex: /代表取締役\s+[^\n\r]{1,120}/g,
    },
    {
      id: 'label_daihyo_short',
      type: 'PERSON_NAME_HINT',
      regex: /(?<!代表取締役\s)(?:代表者|代表)\s+[^\n\r]{1,120}/g,
    },
    {
      id: 'label_tanto_line',
      type: 'PERSON_NAME_HINT',
      regex: /(?:甲側|乙側)?担当[:：]\s*[^\n\r]+/g,
    },
    {
      id: 'label_shimei',
      type: 'PERSON_NAME_HINT',
      regex: /氏名[:：]\s*[^\n\r]+/g,
    },
    {
      id: 'label_company_name',
      type: 'COMPANY_NAME_HINT',
      regex: /会社名[:：]\s*[^\n\r]+/g,
    },
  ];

  const rawSpans = collectRuleSpans(content, rules);
  const selected = selectNonOverlapping(rawSpans);

  const ruleHits: Record<string, number> = {};
  for (const s of selected) {
    ruleHits[s.ruleId] = (ruleHits[s.ruleId] ?? 0) + 1;
  }

  let maskedContent = content;
  const byEnd = [...selected].sort((a, b) => b.start - a.start);
  for (const s of byEnd) {
    const token = `[REDACTED:${s.type}]`;
    maskedContent =
      maskedContent.slice(0, s.start) + token + maskedContent.slice(s.end);
  }

  const maskedSpans: MaskedSpan[] = selected.map((s) => ({
    start: s.start,
    end: s.end,
    type: s.type,
    ruleId: s.ruleId,
  }));

  return {
    provider: 'simple-rule',
    maskedContent,
    maskedSpans,
    ruleHits,
  };
}

export function hashSourceContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
