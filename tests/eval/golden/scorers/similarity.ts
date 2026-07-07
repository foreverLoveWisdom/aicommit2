import type { MessageParts, SimilarityScore } from '../types.js';

const SUBJECT_WEIGHT = 0.7;
const BODY_WEIGHT = 0.3;

// Grammatical stopwords only — verbs like "add"/"fix" are content here.
const STOPWORDS = new Set('a an and are as at be by for from in into is it of on or so that the this to was when with'.split(' '));

// Deliberately LOOSER than src/utils/commit-context parseSubject: this strips
// (not parses) any "type(scope): " prefix so similarity measures the description
// alone — style/type/scope judgments belong to conformance and typeAgreement.
const CONVENTIONAL_PREFIX = /^(\w+)(?:\([^)]*\))?!?:\s*/;

const tokenize = (text: string): Set<string> => {
    const words = text
        .toLowerCase()
        .replace(CONVENTIONAL_PREFIX, '')
        .split(/[^a-z0-9]+/)
        .filter(word => word.length >= 2 && !STOPWORDS.has(word));
    return new Set(words);
};

const jaccard = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 && b.size === 0) {
        return 1;
    }
    if (a.size === 0 || b.size === 0) {
        return 0;
    }
    const intersection = [...a].filter(word => b.has(word)).length;
    const union = new Set([...a, ...b]).size;
    return intersection / union;
};

/**
 * Content-word overlap between a generated message and the real human-written
 * one. Catches the "hollow but well-formed" failure mode conformance cannot.
 */
export const scoreSimilarity = (generated: MessageParts, real: MessageParts): SimilarityScore => {
    const subjectOverlap = jaccard(tokenize(generated.subject), tokenize(real.subject));

    const realHasBody = real.body.trim().length > 0;
    if (!realHasBody) {
        return { subjectOverlap, bodyOverlap: null, total: subjectOverlap };
    }

    const bodyOverlap = jaccard(tokenize(generated.body), tokenize(real.body));
    const total = subjectOverlap * SUBJECT_WEIGHT + bodyOverlap * BODY_WEIGHT;
    return { subjectOverlap, bodyOverlap, total };
};
