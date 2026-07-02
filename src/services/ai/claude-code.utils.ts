import type { AIServiceError } from './ai.service.js';

export const CLAUDE_CODE_DEFAULT_MODEL = 'sonnet';

export interface ClaudeCodeResponse {
    result: string;
    isError: boolean;
}

export const normalizeClaudeCodeModel = (model?: string): string => {
    const normalized = (model || '').trim();
    return normalized || CLAUDE_CODE_DEFAULT_MODEL;
};

export const buildClaudeCodeArgs = (model: string, systemPrompt: string): string[] => [
    '-p',
    '--output-format',
    'json',
    '--model',
    model,
    '--system-prompt',
    systemPrompt,
    '--tools',
    '',
    '--max-turns',
    '1',
];

export const parseClaudeCodeResponse = (stdout: string): ClaudeCodeResponse => {
    const trimmed = (stdout || '').trim();
    if (!trimmed) {
        return { result: '', isError: false };
    }
    try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        return {
            result: typeof parsed.result === 'string' ? parsed.result.trim() : '',
            isError: parsed.is_error === true,
        };
    } catch {
        // The CLI may emit plain text when JSON output is unsupported (older versions).
        return { result: trimmed, isError: false };
    }
};

export const isClaudeCodeAuthError = (message: string): boolean => {
    const normalized = message.toLowerCase();
    return (
        normalized.includes('authentication') ||
        normalized.includes('unauthorized') ||
        normalized.includes('not logged in') ||
        normalized.includes('login required') ||
        normalized.includes('please run /login') ||
        normalized.includes('invalid api key') ||
        normalized.includes('oauth token has expired')
    );
};

export const classifyClaudeCodeError = (error: unknown): AIServiceError => {
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
    if (!aiError.code && isClaudeCodeAuthError(detail)) {
        aiError.code = 'AUTH_FAILED';
        // Recent execa versions already embed stderr in error.message; avoid duplicating it.
        aiError.message = stderr || raw.message;
    }
    return aiError;
};
