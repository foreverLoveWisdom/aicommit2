import { expect, testSuite } from 'manten';

import { getAvailableAIs } from '../../../src/commands/get-available-ais.js';
import {
    buildGeminiCliArgs,
    buildGeminiCliPrompt,
    classifyGeminiCliError,
    isGeminiCliAuthError,
    normalizeGeminiCliModel,
    parseGeminiCliResponse,
} from '../../../src/services/ai/gemini-cli.utils.js';

export default testSuite(({ describe }) => {
    describe('gemini cli utils', ({ test }) => {
        test('normalizes model by trimming, no default forced', () => {
            expect(normalizeGeminiCliModel(undefined)).toBe('');
            expect(normalizeGeminiCliModel('')).toBe('');
            expect(normalizeGeminiCliModel('   ')).toBe('');
            expect(normalizeGeminiCliModel(' gemini-2.5-pro ')).toBe('gemini-2.5-pro');
        });

        test('builds headless json args and omits model when empty', () => {
            expect(buildGeminiCliArgs('')).toEqual(['--output-format', 'json']);
        });

        test('builds args with model when configured', () => {
            expect(buildGeminiCliArgs('gemini-2.5-pro')).toEqual(['--output-format', 'json', '--model', 'gemini-2.5-pro']);
        });

        test('merges system and user prompts into a single payload', () => {
            expect(buildGeminiCliPrompt('SYS', 'USER')).toBe('SYS\n\n---\n\nUSER');
        });

        test('parses JSON output and extracts response field', () => {
            const parsed = parseGeminiCliResponse('{"response": "feat: add feature", "stats": {}}');
            expect(parsed.result).toBe('feat: add feature');
            expect(parsed.isError).toBe(false);
        });

        test('flags top-level error object and surfaces its message', () => {
            const parsed = parseGeminiCliResponse('{"error": {"type": "Error", "message": "quota exceeded", "code": 1}}');
            expect(parsed.result).toBe('quota exceeded');
            expect(parsed.isError).toBe(true);
        });

        test('falls back to raw text for non-JSON output', () => {
            const parsed = parseGeminiCliResponse('feat: plain text message\n');
            expect(parsed.result).toBe('feat: plain text message');
            expect(parsed.isError).toBe(false);
        });

        test('returns empty response for empty output', () => {
            expect(parseGeminiCliResponse('')).toEqual({ result: '', isError: false });
            expect(parseGeminiCliResponse('   ')).toEqual({ result: '', isError: false });
        });

        test('returns empty result when JSON has no text field', () => {
            expect(parseGeminiCliResponse('{"stats": {}}').result).toBe('');
        });

        test('detects auth error patterns', () => {
            expect(isGeminiCliAuthError('authentication failed')).toBe(true);
            expect(isGeminiCliAuthError('Unauthorized')).toBe(true);
            expect(isGeminiCliAuthError('You are not authenticated')).toBe(true);
            expect(isGeminiCliAuthError('You are not logged in')).toBe(true);
            expect(isGeminiCliAuthError('Login required')).toBe(true);
            expect(isGeminiCliAuthError('Please sign in to continue')).toBe(true);
            expect(isGeminiCliAuthError('OAuth token has expired')).toBe(true);
        });

        test('does not false-positive on non-auth messages', () => {
            expect(isGeminiCliAuthError('network timeout')).toBe(false);
            expect(isGeminiCliAuthError('token limit reached')).toBe(false);
            expect(isGeminiCliAuthError('model not found')).toBe(false);
        });

        // Matches the execa failure shape classifyGeminiCliError reads.
        const createExecaError = (message: string, fields: { code?: string; stderr?: string; timedOut?: boolean } = {}) =>
            Object.assign(new Error(message), fields);

        test('classifies ENOENT as CLI_NOT_INSTALLED', () => {
            const error = createExecaError('spawn gemini ENOENT', { code: 'ENOENT' });
            expect(classifyGeminiCliError(error).code).toBe('CLI_NOT_INSTALLED');
        });

        test('classifies timed-out execa error as TIMEOUT', () => {
            const error = createExecaError('Command timed out', { timedOut: true });
            expect(classifyGeminiCliError(error).code).toBe('TIMEOUT');
        });

        test('classifies auth stderr as AUTH_FAILED', () => {
            const error = createExecaError('Command failed with exit code 1', { stderr: 'You are not logged in.' });
            expect(classifyGeminiCliError(error).code).toBe('AUTH_FAILED');
        });

        test('keeps existing error code', () => {
            const error = createExecaError('No content in Gemini CLI response', { code: 'NO_CONTENT' });
            expect(classifyGeminiCliError(error).code).toBe('NO_CONTENT');
        });

        test('wraps non-Error values', () => {
            const classified = classifyGeminiCliError('boom');
            expect(classified.message).toBe('boom');
            expect(classified.code).toBe(undefined);
        });

        test('preserves stderr as message on auth failure without duplicating it', () => {
            const stderr = 'Not logged in.';
            const error = createExecaError(`Command failed with exit code 1\n${stderr}`, { stderr });
            expect(classifyGeminiCliError(error).message).toBe(stderr);
        });

        test('GEMINI_CLI is available without API key when model is configured', () => {
            const config = {
                codeReview: true,
                watchMode: true,
                GEMINI_CLI: {
                    model: ['gemini-2.5-pro'],
                    key: '',
                },
            } as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- minimal config mock for testing

            expect(getAvailableAIs(config, 'commit')).toContain('GEMINI_CLI');
            expect(getAvailableAIs(config, 'review')).toContain('GEMINI_CLI');
            expect(getAvailableAIs(config, 'watch')).toContain('GEMINI_CLI');
        });

        test('GEMINI_CLI is not available without an explicit opt-in model', () => {
            const config = {
                codeReview: true,
                watchMode: true,
                GEMINI_CLI: {
                    model: [],
                    key: '',
                },
            } as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- minimal config mock for testing

            expect(getAvailableAIs(config, 'commit')).not.toContain('GEMINI_CLI');
            expect(getAvailableAIs(config, 'review')).not.toContain('GEMINI_CLI');
            expect(getAvailableAIs(config, 'watch')).not.toContain('GEMINI_CLI');
        });
    });
});
