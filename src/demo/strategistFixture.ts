// TODO(W3-strategist): sensitivity に 'Confidential -> AI-safe' などの
// enum 外文字列が含まれている。Strategist agent 実装時に
// src/agents/strategist/schema.ts を切り、専用 enum (例: AiSafetyTransform)
// で表現し直す。現状は Strategist 未実装のため fixture として暫定許容。
import type { ContextPackageExportInput } from '../lib/exportContextPackage';

export const payrollTrainingStrategistFixture: ContextPackageExportInput = {
  purpose: '新人スタッフ向けに給与計算業務を学べるAIを作りたい',
  generatedAt: '2026-05-08 18:00 JST',
  sourceDocumentsReviewed: 10,
  includedDocuments: [
    {
      fileName: '給与計算チェックリスト.md',
      reason: '現行版であり、月次給与計算の基本手順を含む',
      sourceType: 'Checklist',
      sensitivity: 'Internal',
      aiSafeContent:
        '勤怠データを確認する\n残業時間、欠勤、控除項目を確認する\n健康保険料・厚生年金保険料の標準報酬月額を確認する\n支給前に先輩確認が必要なケースを確認する',
    },
    {
      fileName: '給与計算_例外対応メモ.txt',
      reason: '新人がつまずきやすい例外対応の論点を含む。最新値は人間確認が必要',
      sourceType: 'Text',
      sensitivity: 'Internal',
      aiSafeContent:
        '月途中退職、遡及支給、産休・育休復帰、賞与の社会保険料などは例外対応として扱う。\n顧問先ごとの運用差分と最新料率は人間の確認対象にする。',
    },
    {
      fileName: '顧客対応メモ_匿名化.txt',
      reason: '匿名化済みの相談例として、顧問先ごとの差分確認の流れを学習できる',
      sourceType: 'Text',
      sensitivity: 'Confidential -> AI-safe',
      aiSafeContent:
        '[Customer_001] の育児休業給付金申請で、必要書類と賃金算定の確認を行った。\n追加資料を依頼し、期限までに申請書類を完成させる。',
    },
  ],
  excludedDocuments: [
    {
      fileName: '古い料金表_2023.csv',
      reason: '旧版候補。給与計算教育AIの根拠資料には使わない',
    },
    {
      fileName: '料金表_2026.csv',
      reason: '現行料金表だが、今回の目的では給与計算手順に直接関係しない',
    },
    {
      fileName: '年末調整_案内文.txt',
      reason: '年末調整の案内文であり、給与計算の月次業務とは目的が異なる',
    },
  ],
  humanReviewDocuments: [
    {
      fileName: '顧問契約書_実案件サンプル.txt',
      reason:
        'Masker detected residual re-identification risk after masking contract parties, address, fee, and bank details',
      status: 'Promoted by Masker: Confidential -> Restricted',
    },
  ],
  missingKnowledge: [
    '給与計算で先輩確認が必須になる例外条件',
    '顧問先ごとの締め日、支給日、交通費ルールの管理方法',
    '社会保険料率や税額表の最新化責任者と更新頻度',
  ],
  questionsForHumanOwner: [
    '新人スタッフにAIが回答してよい範囲と、必ず先輩確認に回す範囲はどこですか?',
    '顧問先別ルールはどの資料を正本として扱いますか?',
    '給与計算チェックリストの更新責任者と更新タイミングは決まっていますか?',
  ],
};
