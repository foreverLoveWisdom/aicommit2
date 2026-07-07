// CLI entrypoints (extract-corpus.ts, run.ts) are intentionally NOT exported —
// importing them would execute their top-level await main().
export * from './types.js';
export { scoreConformance, scoreSimilarity, parseConventionalType } from './scorers/index.js';
export { assertClaudeCliAvailable, createClaudeCodeGenerator } from './providers.js';
export type { GenerateFn } from './providers.js';
