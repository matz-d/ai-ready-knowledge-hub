#!/usr/bin/env bash
# Generates a <=5 MiB scan-pdf fixture intended for OCR fail-closed evidence.
# This fixture is separate from degraded-scan-fail-closed.pdf (413-only evidence).
# Dependency: ImageMagick (`magick` on v7, or `convert` on v6).
# PDF rasterization may also need ImageMagick's Ghostscript delegate (`gs`).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
INPUT_PDF="$REPO_ROOT/sample-data/document-conversion/scan-pdf/mhlw-labor-conditions-notice-blank-scan.pdf"
OUTPUT_PDF="$REPO_ROOT/sample-data/document-conversion/scan-pdf/ocr-fail-closed-preflight.pdf"
MAX_BYTES=$((5 * 1024 * 1024))

if [[ ! -f "$INPUT_PDF" ]]; then
  echo "Skip: source scan PDF is missing: $INPUT_PDF" >&2
  exit 0
fi

if command -v magick >/dev/null 2>&1; then
  imagemagick=(magick)
elif command -v convert >/dev/null 2>&1; then
  imagemagick=(convert)
else
  echo "ImageMagick is required. On macOS, install it with: brew install imagemagick" >&2
  exit 1
fi

if ! command -v gs >/dev/null 2>&1; then
  echo "Ghostscript is required by this ImageMagick PDF workflow. On macOS, install it with: brew install ghostscript" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PDF")"

"${imagemagick[@]}" \
  -density 72 \
  "$INPUT_PDF" \
  -units PixelsPerInch \
  -density 72 \
  -background white \
  -alpha remove \
  -alpha off \
  -colorspace Gray \
  -resize 35% \
  -blur 0x3 \
  -threshold 55% \
  -negate \
  +noise Multiplicative \
  -attenuate 0.8 \
  +noise Gaussian \
  -brightness-contrast -15x-55 \
  -rotate -2 \
  "$OUTPUT_PDF"

actual_size="$(wc -c < "$OUTPUT_PDF" | tr -d '[:space:]')"
if [[ "$actual_size" -gt "$MAX_BYTES" ]]; then
  echo "Generated fixture exceeds 5 MiB (${actual_size} bytes): $OUTPUT_PDF" >&2
  exit 1
fi

echo "Generated OCR fail-closed fixture: $OUTPUT_PDF (${actual_size} bytes)"
