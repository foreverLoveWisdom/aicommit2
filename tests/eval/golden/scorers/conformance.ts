import { analyzeConventions, parseSubject } from '../../../../src/utils/commit-context/index.js';

import type { ConventionProfile, ParsedSubject } from '../../../../src/utils/commit-context/types.js';
import type { ConformanceScore } from '../types.js';

const WEIGHTS = { style: 0.3, type: 0.3, scope: 0.2, length: 0.2 } as const;

const scoreLength = (subjectLength: number, referenceLength: number): number => {
    if (referenceLength <= 0) {
        return 0;
    }
    const deviation = Math.abs(subjectLength - referenceLength) / referenceLength;
    return Math.max(0, 1 - deviation);
};

const meanLength = (subjects: string[]): number => {
    if (subjects.length === 0) {
        return 0;
    }
    const lengthSum = subjects.reduce((sum, subject) => sum + subject.trim().length, 0);
    return lengthSum / subjects.length;
};

const scoreStyle = (parsed: ParsedSubject, profile: ConventionProfile): number | null => {
    if (profile.dominantType === null) {
        return null;
    }
    return parsed.style === profile.dominantType ? 1 : 0;
};

const scoreType = (parsed: ParsedSubject, profile: ConventionProfile): number | null => {
    const counts = Object.values(profile.typeDistribution);
    if (counts.length === 0) {
        return null;
    }
    if (!parsed.type) {
        return 0;
    }
    const maxCount = Math.max(...counts);
    return (profile.typeDistribution[parsed.type] || 0) / maxCount;
};

const scoreScope = (parsed: ParsedSubject, profile: ConventionProfile): number | null => {
    if (profile.commonScopes.length === 0) {
        return null;
    }
    if (!parsed.scope) {
        return 0;
    }
    return profile.commonScopes.includes(parsed.scope) ? 1 : 0;
};

const weightedTotal = (score: Omit<ConformanceScore, 'total'>): number => {
    const components: Array<[number | null, number]> = [
        [score.styleMatch, WEIGHTS.style],
        [score.typeValid, WEIGHTS.type],
        [score.scopeMatch, WEIGHTS.scope],
        [score.lengthScore, WEIGHTS.length],
    ];
    let activeWeight = 0;
    let weightedSum = 0;
    for (const [value, weight] of components) {
        if (value === null) {
            continue;
        }
        activeWeight += weight;
        weightedSum += value * weight;
    }
    // lengthScore is always non-null, so activeWeight >= WEIGHTS.length — no zero-division guard needed.
    return weightedSum / activeWeight;
};

/** Conventional type of a subject, null when not conventional — used for typeAgreement. */
export const parseConventionalType = (subject: string): string | null => parseSubject(subject.trim()).type;

/**
 * Score how well a generated subject conforms to the style profile learned
 * from the commits that existed BEFORE the target commit. Consumes the exact
 * analyzeConventions/parseSubject lens the context engine feeds into the
 * prompt — scoring and enrichment cannot drift apart.
 */
export const scoreConformance = (generatedSubject: string, priorSubjects: string[]): ConformanceScore => {
    const subject = generatedSubject.trim();
    if (priorSubjects.length === 0) {
        return { styleMatch: null, typeValid: null, scopeMatch: null, lengthScore: 0, total: 0 };
    }

    const profile = analyzeConventions(priorSubjects);
    const lengthReference = profile?.avgSubjectLength || meanLength(priorSubjects);
    const lengthScore = scoreLength(subject.length, lengthReference);

    // Unstructured history: no convention to conform to — length is the only judgeable axis.
    if (!profile) {
        return { styleMatch: null, typeValid: null, scopeMatch: null, lengthScore, total: lengthScore };
    }

    const parsed = parseSubject(subject);
    const partial = {
        styleMatch: scoreStyle(parsed, profile),
        typeValid: scoreType(parsed, profile),
        scopeMatch: scoreScope(parsed, profile),
        lengthScore,
    };
    return { ...partial, total: weightedTotal(partial) };
};
