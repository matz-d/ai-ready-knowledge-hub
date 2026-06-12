# scripts/

ローカル運用・評価・CI 補助用の TypeScript エントリポイント。`.env.local` は `loadEnv.ts` 経由で読み込む（`scripts/` 直下および `oneoff/` から `import '../loadEnv'`）。

`package.json` の `pnpm` エイリアスがあるものは表に記載。エイリアスがないものは `pnpm tsx scripts/<path>` で直接実行する。

## 常用 ops

| スクリプト | pnpm コマンド | 用途 |
|---|---|---|
| `runCurator.ts` | `pnpm curator [path]` | Curator flow を 1 ファイルに対し実行 |
| `runCuratorAll.ts` | `pnpm curator:all [dir]` | ディレクトリ内全件で Curator smoke |
| `runMaskerRisk.ts` | `pnpm masker:risk [path]` | Masker A8 residualRisk 評価 |
| `runMaskerPipeline.ts` | `pnpm masker:pipeline [path]` | 原本 → SimpleMasker → residualRisk → status 判定 |
| `runDlpMaskerSmoke.ts` | `pnpm masker:dlp:smoke [path]` | Cloud DLP provider 疎通確認 |
| `regenerateChunks.ts` | `pnpm chunks:regenerate <docId>` | Firestore `documents/{docId}/chunks` 全置換 |
| `generateInventorySnapshot.ts` | `pnpm inventory:snapshot` | `docs/w1-artifacts/inventory.snapshot.json` 再生成 |
| `runContextPackageDemo.ts` | `pnpm context:demo` / `:live` / `:w1` | Context Package Markdown 出力デモ |
| `runStrategist.ts` | `pnpm strategist` | Strategist flow 手動 smoke |
| `scanMiniShaiHuludIocs.ts` | `pnpm security:ioc:mini-shai-hulud` | npm サプライチェーン IOC スキャン |
| `regenerateScanPdfGoldenSidecars.ts` | （直接実行） | scan-pdf `*.expected.json` golden sidecar 再生成 |

## eval

| スクリプト | pnpm コマンド | 用途 |
|---|---|---|
| `runConversionEvalForCi.ts` | （CI: `.github/workflows/conversion-eval.yml`） | conversion eval 本番 CI エントリ |
| `runCuratorClassificationEval.ts` | `pnpm eval:curator:classification` | Curator 分類 precision eval |
| `runP1dQualityGate.ts` | `pnpm eval:p1d:quality` | P1-D extraction/masking quality gate |
| `runP1dMixedPdfCheck.ts` | `pnpm eval:p1d:mixed-pdf` | P1-D mixed PDF local check |
| `exportConversionEvalSamples.ts` | （直接実行） | Firestore から conversion eval サンプル export |

## 一回限り（実施済み・`oneoff/`）

証跡 doc から参照されるため削除せず隔離。再実行が必要な場合のみ `pnpm tsx scripts/oneoff/<name>.ts` を使う。

| スクリプト | 実施時期・根拠 | 用途 |
|---|---|---|
| `oneoff/backfillSourceKind.ts` | Phase 3-B（2026-05） | `schemaVersion` 1 → 2、`sourceKind` backfill |
| `oneoff/recurateDocument.ts` | 2026-06-09 | 単一 doc の curator 再分類 remediation |
| `oneoff/verifyP1fPayrollAcceptance.ts` | 2026-06-10 | P1-F 給与シナリオ async acceptance（evidence 化） |
| `oneoff/buildDeliveryE2ePackage.ts` | 2026-06-09 | delivery E2E offline fallback `.md` / source bundle 生成 |
| `oneoff/compareScanPdfGoldenSidecarToMainline.ts` | Phase 3-H-3 M6 | PoC sidecar vs 本線 OCR の golden recall 比較 |
| `oneoff/verifyScanPdfUnmaskableFixture.ts` | Phase 3-H-3 | `synthetic-unmaskable-pii-scan.pdf` fixture 検証（`pnpm fixtures:scan-pdf:unmaskable:verify`） |

## 共有

| ファイル | 用途 |
|---|---|
| `loadEnv.ts` | `scripts/` 実行時に `.env.local` を読み込む（本番バンドル対象外） |
