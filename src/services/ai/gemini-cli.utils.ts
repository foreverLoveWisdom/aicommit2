import type { AIServiceError } from './ai.service.js';

export interface GeminiCliResponse {
    result: string;
    isError: boolean;
}

/**
 * Trim the configured model. Unlike Claude Code, no default is forced:
 * an empty model omits `--model` so the CLI uses the subscription default.
 */
export const normalizeGeminiCliModel = (model?: string): string => (model || '').trim();

/**
 * Gemini CLI has no `--system-prompt` flag, so the system and user prompts
 * are merged into a single stdin payload.
 */
export const buildGeminiCliPrompt = (systemPrompt: string, userPrompt: string): string => `${systemPrompt}\n\n---\n\n${userPrompt}`;

/**
 * Headless args for `gemini`. The merged prompt is passed via stdin, not argv.
 * `--model` is omitted when empty so the CLI falls back to its default model.
 */
export const buildGeminiCliArgs = (model: string): string[] => {
    const args = ['--output-format', 'json'];
    if (model) {
        args.push('--model', model);
    }
    return args;
};

/**
 * Parse `gemini --output-format json` output. Success emits a single JSON
 * object `{ response, stats }`; errors emit `{ error: { message, code } }`.
 * Falls back to raw text for older CLI versions without JSON support.
 */
export const parseGeminiCliResponse = (stdout: string): GeminiCliResponse => {
    const trimmed = (stdout || '').trim();
    if (!trimmed) {
        return { result: '', isError: false };
    }
    try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const hasError = typeof parsed.error === 'object' && parsed.error !== null;
        if (hasError) {
            const errorObj = parsed.error as Record<string, unknown>;
            const message = typeof errorObj.message === 'string' ? errorObj.message.trim() : '';
            return { result: message, isError: true };
        }
        // `response` is Gemini CLI's success field (JsonOutput in @google/gemini-cli-core).
        const text = typeof parsed.response === 'string' ? parsed.response.trim() : '';
        return { result: text, isError: false };
    } catch {
        // The CLI may emit plain text when JSON output is unsupported (older versions).
        return { result: trimmed, isError: false };
    }
};

export const isGeminiCliAuthError = (message: string): boolean => {
    const normalized = message.toLowerCase();
    return (
        normalized.includes('authentication') ||
        normalized.includes('unauthorized') ||
        normalized.includes('not authenticated') ||
        normalized.includes('not logged in') ||
        normalized.includes('login required') ||
        normalized.includes('please sign in') ||
        normalized.includes('oauth token has expired')
    );
};

export const classifyGeminiCliError = (error: unknown): AIServiceError => {
    const raw = error instanceof Error ? error : new Error(String(error));
    const { code, stderr, timedOut } = raw as Error & { code?: string; stderr?: string; timedOut?: boolean };
    const aiError = raw as AIServiceError;

    if (code === 'ENOENT') {
        aiError.code = 'CLI_NOT_INSTALLED';
        return aiError;
    }
    if (timedOut) {
        aiError.code = 'TIMEOUT';
        return aiError;
    }

    const detail = [stderr, raw.message].filter(Boolean).join('\n');
    if (!aiError.code && isGeminiCliAuthError(detail)) {
        aiError.code = 'AUTH_FAILED';
        // Recent execa versions already embed stderr in error.message; avoid duplicating it.
        aiError.message = stderr || raw.message;
    }
    return aiError;
};
