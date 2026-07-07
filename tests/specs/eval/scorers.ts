import { expect, testSuite } from 'manten';

import { scoreConformance, scoreSimilarity } from '../../eval/golden/scorers/index.js';

import type { MessageParts } from '../../eval/golden/types.js';

const msg = (subject: string, body = ''): MessageParts => ({ subject, body });

const conventionalHistory = [
    'feat(core): add provider registry',
    'fix(core): handle empty diff',
    'feat(cli): add rewrite flag',
    'fix(prompt): escape braces in template',
    'feat(core): wire context builder',
    'chore(deps): bump execa',
];

export default testSuite(({ describe }) => {
    describe('Golden Eval Scorers', ({ describe }) => {
        describe('scoreConformance', ({ test }) => {
            test('scores high for a subject matching the repo profile', () => {
                const score = scoreConformance('feat(core): add golden eval harness', conventionalHistory);
                expect(score.styleMatch).toBe(1);
                expect(score.typeValid).toBe(1); // feat is the most frequent type
                expect(score.scopeMatch).toBe(1); // core is a common scope
                expect(score.total).toBeGreaterThan(0.8);
            });

            test('zeroes styleMatch when style diverges from dominant', () => {
                const score = scoreConformance(':sparkles: add golden eval harness', conventionalHistory);
                expect(score.styleMatch).toBe(0);
            });

            test('zeroes typeValid for a type the repo never uses', () => {
                const score = scoreConformance('perf(core): speed up parser', conventionalHistory);
                expect(score.typeValid).toBe(0);
            });

            test('weights typeValid by historical frequency', () => {
                const score = scoreConformance('chore(core): tidy up', conventionalHistory);
                expect(score.typeValid).toBeGreaterThan(0);
                expect(score.typeValid).toBeLessThan(1);
            });

            test('nulls scopeMatch and redistributes when history has no scopes', () => {
                const scopelessHistory = ['feat: one', 'fix: two', 'feat: three'];
                const score = scoreConformance('feat: add thing', scopelessHistory);
                expect(score.scopeMatch).toBe(null);
                expect(score.total).toBeGreaterThan(0.8); // style+type+length all good
            });

            test('zeroes scopeMatch when repo uses scopes but generation omits one', () => {
                const score = scoreConformance('feat: add golden eval harness', conventionalHistory);
                expect(score.scopeMatch).toBe(0);
            });

            test('falls back to length-only when history has no convention signal', () => {
                const unstructured = ['update the config parser', 'rework request handling', 'clean up old helpers'];
                const score = scoreConformance('another plain update here', unstructured);
                expect(score.styleMatch).toBe(null);
                expect(score.typeValid).toBe(null);
                expect(score.scopeMatch).toBe(null);
                expect(score.lengthScore).toBeGreaterThan(0);
                expect(score.total).toBe(score.lengthScore);
            });

            test('penalizes extreme length deviation', () => {
                const longSubject = `feat(core): ${'x'.repeat(300)}`;
                const score = scoreConformance(longSubject, conventionalHistory);
                expect(score.lengthScore).toBe(0);
            });

            test('returns zeroed score for empty history', () => {
                const score = scoreConformance('feat: anything', []);
                expect(score.total).toBe(0);
            });
        });

        describe('scoreSimilarity', ({ test }) => {
            test('scores 1 for identical content after prefix strip', () => {
                const score = scoreSimilarity(msg('feat(core): add user login flow'), msg('fix(auth): add user login flow'));
                expect(score.subjectOverlap).toBe(1);
                expect(score.total).toBe(1);
            });

            test('scores 0 for disjoint subjects', () => {
                const score = scoreSimilarity(msg('feat: add websocket reconnect'), msg('docs: rewrite readme badges'));
                expect(score.subjectOverlap).toBe(0);
            });

            test('nulls bodyOverlap when the real commit has no body', () => {
                const score = scoreSimilarity(msg('feat: add thing', 'generated body text'), msg('feat: add thing'));
                expect(score.bodyOverlap).toBe(null);
                expect(score.total).toBe(score.subjectOverlap);
            });

            test('zeroes bodyOverlap when real has a body but generation omits it', () => {
                const score = scoreSimilarity(msg('feat: add thing'), msg('feat: add thing', 'explains the change rationale here'));
                expect(score.bodyOverlap).toBe(0);
                expect(score.total).toBeLessThan(1);
            });

            test('scores partial overlap between related subjects', () => {
                const score = scoreSimilarity(
                    msg('feat(core): add commit context builder'),
                    msg('feat(core): add context builder for commits')
                );
                expect(score.subjectOverlap).toBeGreaterThan(0.5);
                expect(score.subjectOverlap).toBeLessThanOrEqual(1);
            });
        });
    });
});
