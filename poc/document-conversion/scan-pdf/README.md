# scan-pdf PoC

`runner.ts` は Gemini/Vertex AI OCR で scan PDF を観察する PoC runner。

## Degraded fail-closed fixture

`fixtures/generate-degraded.sh` は、白紙の労働条件通知書 scan を 150 dpi 相当に rasterize し、5 度傾け、Gaussian noise と低コントラスト化を加えて、OCR fail-closed 観察用の `degraded-scan-fail-closed.pdf` を生成する。

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
