import { execa } from 'execa';

import { buildClaudeCodeArgs, parseClaudeCodeResponse } from '../../../src/services/ai/claude-code.utils.js';

/** Provider-agnostic generation: (system, user) → raw model text */
export type GenerateFn = (systemPrompt: string, userPrompt: string) => Promise<string>;

export const assertClaudeCliAvailable = async (): Promise<void> => {
    try {
        await execa('claude', ['--version']);
    } catch {
        throw new Error('Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code, then run `claude` once to log in.');
    }
};

/**
 * Generation arm backed by the local Claude Code CLI — zero API keys,
 * rides the user's existing subscription. Dogfoods the same utils the
 * claude-code provider uses in production.
 */
export const createClaudeCodeGenerator = (model: string, timeoutMs: number): GenerateFn => {
    return async (systemPrompt, userPrompt) => {
        const args = buildClaudeCodeArgs(model, systemPrompt);
        const { stdout } = await execa('claude', args, { input: userPrompt, timeout: timeoutMs });
        const response = parseClaudeCodeResponse(stdout);

        if (response.isError) {
            throw new Error(response.result || 'Claude Code CLI reported an error');
        }
        if (!response.result) {
            throw new Error('No content in Claude Code response');
        }
        return response.result;
    };
};
