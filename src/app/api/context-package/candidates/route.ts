/**
 * `POST /api/context-package/candidates` — purpose-driven candidate selection (Phase 4-UX S2)
 */
import { handleCandidatesPost } from './handler';

export type { CandidatesRouteDeps } from './handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleCandidatesPost(request);
}
