import type {
  P1dExpectedFixture,
  P1dExpectedTableCell,
} from './p1dQualityGate';

type MergeScanPdfExpectedRefreshInput = {
  prior: P1dExpectedFixture;
  candidateFields: readonly string[];
  regeneratedAt: string;
  model: string;
  recall: number | null | undefined;
};

function uniqueNonEmpty(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function canonicalTableCell(cell: P1dExpectedTableCell): string {
  return JSON.stringify({
    tableId: cell.tableId,
    rowLabel: cell.rowLabel,
    columnLabel: cell.columnLabel,
    expectedValue: cell.expectedValue,
    tier: cell.tier ?? 'extended',
  });
}

function expectedTableCellCount(expected: P1dExpectedFixture): number | null {
  if (expected.expectedTableCells === 'not_applicable') return null;
  return Array.isArray(expected.expectedTableCells)
    ? expected.expectedTableCells.length
    : 0;
}

export function assertScanPdfExpectedRefreshDoesNotWeaken(
  prior: P1dExpectedFixture,
  next: P1dExpectedFixture
): void {
  const nextFields = new Set(next.expectedFields);
  const missingFields = prior.expectedFields.filter((field) => !nextFields.has(field));
  if (missingFields.length > 0) {
    throw new Error(
      `scan-pdf expected refresh would drop expectedFields: ${missingFields.join(', ')}`
    );
  }

  for (const [field, tier] of Object.entries(prior.expectedFieldTiers)) {
    if (next.expectedFieldTiers[field] !== tier) {
      throw new Error(
        `scan-pdf expected refresh would drop or change expectedFieldTiers.${field}`
      );
    }
  }

  if (prior.expectedValues.length > 0 && next.expectedValues.length === 0) {
    throw new Error('scan-pdf expected refresh would stop measuring expectedValues');
  }
  const nextValues = new Set(
    next.expectedValues.map((value) =>
      JSON.stringify({
        field: value.field,
        expectedValue: value.expectedValue,
        tier: value.tier ?? 'extended',
      })
    )
  );
  const missingValues = prior.expectedValues.filter(
    (value) =>
      !nextValues.has(
        JSON.stringify({
          field: value.field,
          expectedValue: value.expectedValue,
          tier: value.tier ?? 'extended',
        })
      )
  );
  if (missingValues.length > 0) {
    throw new Error(
      `scan-pdf expected refresh would drop expectedValues: ${missingValues
        .map((value) => `${value.field}=${value.expectedValue}`)
        .join(', ')}`
    );
  }

  if (prior.expectedTableCells === 'not_applicable') {
    if (next.expectedTableCells !== 'not_applicable') {
      throw new Error(
        'scan-pdf expected refresh would change expectedTableCells from not_applicable'
      );
    }
    return;
  }

  if (Array.isArray(prior.expectedTableCells) && prior.expectedTableCells.length > 0) {
    if (!Array.isArray(next.expectedTableCells)) {
      throw new Error('scan-pdf expected refresh would stop measuring expectedTableCells');
    }
    const nextCells = new Set(next.expectedTableCells.map(canonicalTableCell));
    const missingCells = prior.expectedTableCells.filter(
      (cell) => !nextCells.has(canonicalTableCell(cell))
    );
    if (missingCells.length > 0) {
      throw new Error(
        `scan-pdf expected refresh would drop expectedTableCells: ${missingCells
          .map((cell) => cell.expectedValue)
          .join(', ')}`
      );
    }
  }
}

export function mergeScanPdfExpectedRefresh(
  input: MergeScanPdfExpectedRefreshInput
): P1dExpectedFixture {
  const prior = input.prior;
  const expectedFields = uniqueNonEmpty([
    ...prior.expectedFields,
    ...input.candidateFields,
  ]);
  const recall =
    typeof input.recall === 'number' && Number.isFinite(input.recall)
      ? input.recall.toFixed(2)
      : 'n/a';
  const next: P1dExpectedFixture = {
    ...prior,
    expectedFields,
    expectedFieldTiers: { ...prior.expectedFieldTiers },
    expectedValues: [...prior.expectedValues],
    expectedTableCells: Array.isArray(prior.expectedTableCells)
      ? [...prior.expectedTableCells]
      : prior.expectedTableCells,
    notes: (
      `${prior.notes ?? ''} ` +
      `Regenerated ${input.regeneratedAt} from mainline ` +
      `extractScanPdfFromBuffer (model=${input.model}, recall=${recall}); ` +
      `curated expected tiers/values/table cells preserved.`
    ).trim(),
  };

  assertScanPdfExpectedRefreshDoesNotWeaken(prior, next);
  return next;
}

export function summarizeExpectedCoverage(expected: P1dExpectedFixture): {
  expectedFieldCount: number;
  expectedValueCount: number;
  expectedTableCellCount: number | null;
} {
  return {
    expectedFieldCount: expected.expectedFields.length,
    expectedValueCount: expected.expectedValues.length,
    expectedTableCellCount: expectedTableCellCount(expected),
  };
}
