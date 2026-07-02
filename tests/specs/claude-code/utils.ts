import { expect, testSuite } from 'manten';

import { getAvailableAIs } from '../../../src/commands/get-available-ais.js';
import {
    CLAUDE_CODE_DEFAULT_MODEL,
    buildClaudeCodeArgs,
    classifyClaudeCodeError,
    isClaudeCodeAuthError,
    normalizeClaudeCodeModel,
    parseClaudeCodeResponse,
} from '../../../src/services/ai/claude-code.utils.js';

export default testSuite(({ describe }) => {
    describe('claude code utils', ({ test }) => {
        test('normalizes empty model to default', () => {
            expect(normalizeClaudeCodeModel(undefined)).toBe(CLAUDE_CODE_DEFAULT_MODEL);
            expect(normalizeClaudeCodeModel('')).toBe(CLAUDE_CODE_DEFAULT_MODEL);
            expect(normalizeClaudeCodeModel('   ')).toBe(CLAUDE_CODE_DEFAULT_MODEL);
        });

        test('passes through configured model', () => {
            expect(normalizeClaudeCodeModel('opus')).toBe('opus');
            expect(normalizeClaudeCodeModel(' claude-sonnet-5 ')).toBe('claude-sonnet-5');
        });

        test('builds headless args with tools disabled and a single turn', () => {
            const args = buildClaudeCodeArgs('sonnet', 'system prompt');
            expect(args).toEqual([
                '-p',
                '--output-format',
                'json',
                '--model',
                'sonnet',
                '--system-prompt',
                'system prompt',
                '--tools',
                '',
                '--max-turns',
                '1',
            ]);
        });

        test('parses JSON output and extracts result', () => {
            const parsed = parseClaudeCodeResponse('{"result": "feat: add feature", "session_id": "abc"}');
            expect(parsed.result).toBe('feat: add feature');
            expect(parsed.isError).toBe(false);
        });

        test('flags is_error responses', () => {
            const parsed = parseClaudeCodeResponse('{"result": "quota exceeded", "is_error": true}');
            expect(parsed.result).toBe('quota exceeded');
            expect(parsed.isError).toBe(true);
        });

        test('falls back to raw text for non-JSON output', () => {
            const parsed = parseClaudeCodeResponse('feat: plain text message\n');
            expect(parsed.result).toBe('feat: plain text message');
            expect(parsed.isError).toBe(false);
        });

        test('returns empty response for empty output', () => {
            expect(parseClaudeCodeResponse('')).toEqual({ result: '', isError: false });
            expect(parseClaudeCodeResponse('   ')).toEqual({ result: '', isError: false });
        });

        test('returns empty result when JSON has no string result field', () => {
            expect(parseClaudeCodeResponse('{"session_id": "abc"}').result).toBe('');
        });

        test('detects auth error patterns', () => {
            expect(isClaudeCodeAuthError('authentication failed')).toBe(true);
            expect(isClaudeCodeAuthError('Unauthorized')).toBe(true);
            expect(isClaudeCodeAuthError('You are not logged in')).toBe(true);
            expect(isClaudeCodeAuthError('Login required. Please run /login')).toBe(true);
            expect(isClaudeCodeAuthError('Invalid API key')).toBe(true);
            expect(isClaudeCodeAuthError('OAuth token has expired')).toBe(true);
        });

        test('does not false-positive on non-auth messages', () => {
            expect(isClaudeCodeAuthError('network timeout')).toBe(false);
            expect(isClaudeCodeAuthError('token limit reached')).toBe(false);
            expect(isClaudeCodeAuthError('model not found')).toBe(false);
        });

        // Matches the execa failure shape classifyClaudeCodeError reads.
        const createExecaError = (message: string, fields: { code?: string; stderr?: string; timedOut?: boolean } = {}) =>
            Object.assign(new Error(message), fields);

        test('classifies ENOENT as CLI_NOT_INSTALLED', () => {
            const error = createExecaError('spawn claude ENOENT', { code: 'ENOENT' });
            expect(classifyClaudeCodeError(error).code).toBe('CLI_NOT_INSTALLED');
        });

        test('classifies timed-out execa error as TIMEOUT', () => {
            const error = createExecaError('Command timed out', { timedOut: true });
            expect(classifyClaudeCodeError(error).code).toBe('TIMEOUT');
        });

        test('classifies auth stderr as AUTH_FAILED', () => {
            const error = createExecaError('Command failed with exit code 1', { stderr: 'You are not logged in. Please run /login' });
            expect(classifyClaudeCodeError(error).code).toBe('AUTH_FAILED');
        });

        test('keeps existing error code', () => {
            const error = createExecaError('No content in Claude Code response', { code: 'NO_CONTENT' });
            expect(classifyClaudeCodeError(error).code).toBe('NO_CONTENT');
        });

        test('wraps non-Error values', () => {
            const classified = classifyClaudeCodeError('boom');
            expect(classified.message).toBe('boom');
            expect(classified.code).toBe(undefined);
        });

        test('preserves stderr as message on auth failure without duplicating it', () => {
            const stderr = 'Not logged in. Please run /login';
            const error = createExecaError(`Command failed with exit code 1\n${stderr}`, { stderr });
            expect(classifyClaudeCodeError(error).message).toBe(stderr);
        });

        test('CLAUDE_CODE is available without API key when model is configured', () => {
            const config = {
                codeReview: true,
                watchMode: true,
                CLAUDE_CODE: {
                    model: ['sonnet'],
                    key: '',
                },
            } as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- minimal config mock for testing

            expect(getAvailableAIs(config, 'commit')).toContain('CLAUDE_CODE');
            expect(getAvailableAIs(config, 'review')).toContain('CLAUDE_CODE');
            expect(getAvailableAIs(config, 'watch')).toContain('CLAUDE_CODE');
        });

        test('CLAUDE_CODE is not available without an explicit opt-in model', () => {
            const config = {
                codeReview: true,
                watchMode: true,
                CLAUDE_CODE: {
                    model: [],
                    key: '',
                },
            } as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- minimal config mock for testing

            expect(getAvailableAIs(config, 'commit')).not.toContain('CLAUDE_CODE');
            expect(getAvailableAIs(config, 'review')).not.toContain('CLAUDE_CODE');
            expect(getAvailableAIs(config, 'watch')).not.toContain('CLAUDE_CODE');
        });
    });
});
