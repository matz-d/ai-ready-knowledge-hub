/**
 * Maps English/romaji/abbreviation trigger terms to Japanese BusinessDomain canonical strings.
 *
 * Keys must be lowercase (purposeTerms() lowercases before lookup).
 * Values are the exact BusinessDomainEnum values from src/agents/curator/schema.ts.
 * Extend this map when new domain terminology is encountered in purpose inputs.
 */
export const SYNONYM_MAP: Record<string, string[]> = {
  // 料金管理
  invoice: ['料金管理'],
  billing: ['料金管理'],
  '請求': ['料金管理'],
  '料金': ['料金管理'],
  fee: ['料金管理'],

  // 教育・研修
  onboarding: ['教育・研修'],
  training: ['教育・研修'],
  '研修': ['教育・研修'],
  '教育': ['教育・研修'],
  '育成': ['教育・研修'],

  // 給与計算
  payroll: ['給与計算'],
  salary: ['給与計算'],
  '給与': ['給与計算'],
  '賃金': ['給与計算'],
  '給料': ['給与計算'],

  // 顧問契約管理
  contract: ['顧問契約管理'],
  retainer: ['顧問契約管理'],
  '契約': ['顧問契約管理'],
  '顧問': ['顧問契約管理'],

  // 就業規則
  labor: ['就業規則'],
  employment: ['就業規則'],
  '就業': ['就業規則'],
  '労務': ['就業規則'],
  '勤怠': ['就業規則'],

  // 助成金相談
  subsidy: ['助成金相談'],
  grant: ['助成金相談'],
  '助成金': ['助成金相談'],
  '補助金': ['助成金相談'],

  // 顧客対応
  customer: ['顧客対応'],
  client: ['顧客対応'],
  support: ['顧客対応'],
  '顧客': ['顧客対応'],
  'クライアント': ['顧客対応'],

  // 法改正対応
  regulation: ['法改正対応'],
  compliance: ['法改正対応'],
  '法改正': ['法改正対応'],
  '法令': ['法改正対応'],

  // 年末調整
  'year-end': ['年末調整'],
  yearend: ['年末調整'],
  '年末': ['年末調整'],
  '調整': ['年末調整'],

  // 社内手順
  procedure: ['社内手順'],
  process: ['社内手順'],
  '手順': ['社内手順'],
  '業務': ['社内手順'],
};

const JAPANESE_SUBSTRING_SYNONYM_TRIGGERS = new Set([
  '請求',
  '料金',
  '研修',
  '教育',
  '育成',
  '給与',
  '賃金',
  '給料',
  '契約',
  '顧問',
  '就業',
  '労務',
  '勤怠',
  '助成金',
  '補助金',
  '顧客',
  'クライアント',
  '法改正',
  '法令',
  '年末',
]);

/**
 * Expands purpose terms by appending synonym targets.
 * Returned array is deduplicated; original terms are preserved.
 */
export function expandTermsWithSynonyms(terms: string[]): string[] {
  const expanded = new Set(terms);
  for (const term of terms) {
    const targets = SYNONYM_MAP[term];
    if (targets) {
      for (const t of targets) {
        expanded.add(t.toLowerCase());
      }
    }
    for (const [trigger, substringTargets] of Object.entries(SYNONYM_MAP)) {
      if (!JAPANESE_SUBSTRING_SYNONYM_TRIGGERS.has(trigger)) continue;
      if (!term.includes(trigger)) continue;
      for (const t of substringTargets) {
        expanded.add(t.toLowerCase());
      }
    }
  }
  return Array.from(expanded);
}
