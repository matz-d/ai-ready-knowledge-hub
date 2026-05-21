# scan-pdf PoC

`runner.ts` は Gemini/Vertex AI OCR で scan PDF を観察する PoC runner。

**本線統合（M6 完了 2026-05-21）:** upload route は `src/lib/extractors/scanPdfDocumentExtractor.ts` を使用（`pdf-conversion-subtype-3` flag、`m-grow-ai.com` のみ）。PoC runner は fixture 観察・コスト実測・sidecar 再現用。DoD / live smoke: [docs/phase-3-h-3-direction.md](../../../docs/phase-3-h-3-direction.md) §8.3、[docs/phase-3-h-3-scan-pdf-live-smoke.md](../../../docs/phase-3-h-3-scan-pdf-live-smoke.md)。

## OCR fail-closed fixture (<=5 MiB)

`fixtures/generate-ocr-fail-closed.sh` は、白紙の労働条件通知書 scan を低解像度化・二値化・ノイズ付与して、**5 MiB 以下**の `ocr-fail-closed-preflight.pdf` を生成する。`degraded-scan-fail-closed.pdf`（6 MB）は 413 size-limit 証跡専用であり、この用途には使わない。

```bash
bash poc/document-conversion/scan-pdf/fixtures/generate-ocr-fail-closed.sh
```

## Degraded size-limit fixture (413 evidence)

`fixtures/generate-degraded.sh` は、白紙の労働条件通知書 scan を 150 dpi 相当に rasterize し、5 度傾け、Gaussian noise と低コントラスト化を加えて、`degraded-scan-fail-closed.pdf` を生成する。**役割は 5 MiB 超の 413 size-limit 証跡のみ**。

```bash
bash poc/document-conversion/scan-pdf/fixtures/generate-degraded.sh
```

入力 fixture が未配置なら script は生成を skip する。ImageMagick が未導入なら macOS では先に下記を実行する。

```bash
brew install imagemagick
```

Homebrew の ImageMagick で PDF delegate の `gs` が見つからない場合は Ghostscript も入れる。

```bash
brew install ghostscript
```
