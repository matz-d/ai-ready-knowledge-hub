/**
 * Strategist agent boundary (Task3): types only, no LLM.
 * Orchestration will populate these fields when the Strategist flow exists.
 */
export type StrategistDecision = {
  purpose: string;
  includedDocuments: string[];
  excludedDocuments: string[];
  missingKnowledge: string[];
  questionsForHumanOwner: string[];
};
