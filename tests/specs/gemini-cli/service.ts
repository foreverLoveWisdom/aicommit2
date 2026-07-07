import { expect, testSuite } from 'manten';

import { AIServiceError } from '../../../src/services/ai/ai.service.js';
import { GeminiCliService } from '../../../src/services/ai/gemini-cli.service.js';

const createService = (model: string = 'gemini-2.5-pro') =>
    new GeminiCliService({
        config: {
            model: [model],
            timeout: 1000,
            maxTokens: 128,
            temperature: 0.7,
            logging: false,
        } as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- minimal mock for testing
        stagedDiff: {
            files: ['file.ts'],
            diff: 'diff --git a/file.ts b/file.ts',
        },
        keyName: 'GEMINI_CLI',
    });

export default testSuite(({ describe }) => {
    describe('gemini cli service', ({ describe }) => {
        describe('getServiceSpecificErrorMessage', ({ test }) => {
            const callErrorMessage = (code?: AIServiceError['code'], message?: string): string | null => {
                const service = createService();
                const error = new Error(message || '') as AIServiceError;
                if (code) {
                    error.code = code;
                }
                return (service as any).getServiceSpecificErrorMessage(error); // eslint-disable-line @typescript-eslint/no-explicit-any -- accessing protected method
            };

            test('returns install message for CLI_NOT_INSTALLED', () => {
                const result = callErrorMessage('CLI_NOT_INSTALLED');
                expect(result).toContain('not found');
                expect(result).toContain('@google/gemini-cli');
            });

            test('returns auth message for AUTH_FAILED code', () => {
                const result = callErrorMessage('AUTH_FAILED');
                expect(result).toContain('not authenticated');
            });

            test('returns timeout message for TIMEOUT code', () => {
                const result = callErrorMessage('TIMEOUT');
                expect(result).toContain('timed out');
            });

            test('returns no content message for NO_CONTENT code', () => {
                const result = callErrorMessage('NO_CONTENT');
                expect(result).toContain('no content');
            });

            test('returns null for unknown error', () => {
                const result = callErrorMessage(undefined, 'some random error');
                expect(result).toBe(null);
            });
        });
    });
});
