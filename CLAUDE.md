# AI-Ready Knowledge Hub

## Project Purpose

SMEのAI導入担当者が、特定目的のAI活用に必要な社内コンテキストを、安全に集められない課題を解決する。

SMEでは、社内情報がPDF、CSV、メモ、テンプレート、古い資料、個人知に散らばっており、NotebookLM、Gemini、RAGなどにどの情報を渡せばよいか判断しにくい。さらに、顧客情報や個人情報、古い資料、暗黙知が混ざるため、そのままAIに渡すのも危険になる。

このプロジェクトは、散らばった情報を分類し、必要に応じてマスキングし、目的ごとに「使える情報」「除外すべき情報」「足りない情報」「人間に確認すべき質問」を整理して、AIに渡せるContext Packageへ変換する。

NotebookLM、Gemini、RAGを置き換えるのではなく、それらに投入する情報を実務で使える粒度とセキュリティ観点で準備する前段プラットフォームとして位置づける。

## Product One-Liner

SMEの散らばった文書を分類・マスキングし、目的に応じてAIに渡せるContext Packageへ変換する。

## AIエージェント向け（正本ポリシー）

**製品としての定義・目的・スコープは、この `CLAUDE.md` だけを正とする。** `.claude/skills/` の各スキルは GCP / Gemini などの手順補助であり、プロダクトの説明を別途複製しない。読み順と優先ルールは `.claude/skills/project-context/SKILL.md` を参照。

## Shared Agent Contract

このファイルは Claude Code と Codex が共通して読む。Claude Code 固有・Codex 固有の挙動ではなく、両者に有効なプロダクト意図、探索の入口、安全上の不変条件、検証方針だけを書く。

- `CLAUDE.md` には、全セッションで広く効く前提と重要な落とし穴だけを置く。
- GCP / Gemini / Cloud Run などの詳細手順は `.claude/skills/` に置き、このファイルへ重複させない。
- 一時的な調査メモ、フェーズログ、デバッグ記録は `docs/` に置く。
- あるディレクトリだけに効く規約は、必要になった時点でその近くの README や将来のサブディレクトリ `CLAUDE.md` に分離する。

## Repository Map

- `src/app/`: Next.js の画面、API routes、画面コンポーネント。
- `src/agents/`: curator、masker、strategist などの AI flow、prompt、schema。
- `src/lib/`: 抽出、Firestore adapter、Google Workspace import、auth、storage、domain logic。
- `src/services/strategistOrchestrator/`: strategist の出力を Context Package 用の構造へ変換する orchestration。
- `poc/document-conversion/`: official PDF、scan PDF、slide PDF など文書変換の PoC。
- `scripts/`: デモ、バックフィル、再生成、セキュリティ確認などの実行スクリプト。
- `docs/`: architecture、decisions、setup、runbook、phase notes。
- `sample-data/`: synthetic / masked fixture。実顧客データ、個人情報、credential は入れない。

## Where To Start

- Upload / document ingest: `src/lib/uploadOrchestrator.ts`, `src/app/upload/`, `src/app/api/documents/`
- Google Sheets import: `src/lib/googleSheetsSnapshotImporter.ts`, `src/app/import/google-sheets/`, `src/app/api/import/google-sheets/`
- Masking / privacy: `src/agents/masker/`, `src/lib/columnSensitivityRules.ts`
- Context Package generation: `src/agents/strategist/`, `src/services/strategistOrchestrator/`, `src/app/context-package/`
- Document conversion PoC: `poc/document-conversion/README.md`
- GCP / Cloud Run / Gemini operational work: このファイルを読んだ後、該当する `.claude/skills/` を読む。

## Safety Invariants

- 実顧客データ、個人情報、credential、service account key、本番 export を commit しない。
- `sample-data/` と test fixture には synthetic、public、または明示的に masked されたデータだけを置く。
- masking と exclusion は product-critical な振る舞いであり、後回しの polish として扱わない。
- AI に渡してよいか判断できない文書は、投入前に exclusion または human confirmation を優先する。
- Context Package は「使える情報」「除外すべき情報」「足りない情報」「人間に確認すべき質問」を区別する。

## Package Manager Policy

- このリポジトリの package manager は **pnpm**。`npm install` / `npm run ...` / `package-lock.json` は使わない。
- pnpm は `package.json` の `packageManager` に合わせる。`pnpm --version` が `engines.pnpm` を満たさない場合は、作業前に pnpm を更新する。
- 依存関係の install は `pnpm install --frozen-lockfile` を基本とし、lockfile は `pnpm-lock.yaml` を正とする。
- `pnpm-workspace.yaml` の `minimumReleaseAge: 4320` はサプライチェーン対策の正本設定。公開から3日以内の package version を導入してはいけない。

## Verification Policy

- install / build / test の確認は `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm test` で行う。
- TypeScript、schema、型に関わる変更では `pnpm typecheck` を実行する。
- 通常の実装変更では、可能なら対象に近い test を絞って実行してから、必要に応じて `pnpm test` を実行する。
- production readiness に関わる変更では `pnpm build` を実行する。
- live e2e test は credential と環境前提が明示されている場合だけ実行する。
