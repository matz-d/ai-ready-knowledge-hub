#!/usr/bin/env bash
# Generates the degraded scan PDF fixture used to exercise scan-PDF fail-closed behavior.
# Dependency: ImageMagick (`magick` on v7, or `convert` on v6).
# PDF rasterization may also need ImageMagick's Ghostscript delegate (`gs`).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
INPUT_PDF="$REPO_ROOT/sample-data/document-conversion/scan-pdf/mhlw-labor-conditions-notice-blank-scan.pdf"
OUTPUT_PDF="$REPO_ROOT/sample-data/document-conversion/scan-pdf/degraded-scan-fail-closed.pdf"

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
  -density 150 \
  "$INPUT_PDF" \
  -units PixelsPerInch \
  -density 150 \
  -background white \
  -alpha remove \
  -alpha off \
  -colorspace Gray \
  -rotate 5 \
  -seed 7305 \
  -evaluate Gaussian-noise 3 \
  -brightness-contrast 0x-30 \
  "$OUTPUT_PDF"

echo "Generated degraded scan fixture: $OUTPUT_PDF"
