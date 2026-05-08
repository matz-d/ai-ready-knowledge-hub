import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { adaptW1SnapshotEntries } from '../src/lib/inventory';
import { buildContextPackageExportInput } from '../src/lib/contextPackageInput';
import { exportContextPackageMarkdown } from '../src/lib/exportContextPackage';

const snapshotPath = join(
  process.cwd(),
  'docs/w1-artifacts/inventory.snapshot.json'
);

const raw = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
const documents = adaptW1SnapshotEntries(raw);

const exportInput = buildContextPackageExportInput({
  purpose:
    'Demo: Task3 Context Package — W1 snapshot adapted with Restricted exclusion',
  documents,
  generatedAt: new Date(),
  missingKnowledge: ['Live Firestore corpus not connected (Task1/Task2).'],
  questionsForHumanOwner: [
    'Which advisory contract samples may be used in production demos?',
  ],
});

const md = exportContextPackageMarkdown(exportInput);

console.log(md);
console.error(
  `\n--- Summary: included=${exportInput.includedDocuments.length}, humanReview=${exportInput.humanReviewDocuments?.length ?? 0}, excluded=${exportInput.excludedDocuments.length} ---\n`
);
