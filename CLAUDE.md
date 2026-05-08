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
