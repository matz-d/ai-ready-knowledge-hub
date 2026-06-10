/**
 * Upper bound for explicit document selection in one Context Package request.
 *
 * This is a product guard for the research corpus size, not the LLM prompt size.
 * The Strategist input budget still decides how much safe content reaches the
 * model, and async jobs handle slow broad requests.
 */
export const MAX_CONTEXT_PACKAGE_DOC_IDS = 100;
