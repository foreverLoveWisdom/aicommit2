/**
 * Golden-eval domain types.
 *
 * The golden eval replays real commits from a repo's own history:
 * hide the human-written message, regenerate from the diff alone,
 * then score the output against the original. Two arms per commit
 * (context-enriched vs baseline) quantify what the commit-context
 * engine actually buys.
 */

export interface GoldenCommit {
    sha: string;
    /** Human-written subject — the answer key */
    subject: string;
    /** Human-written body, '' when absent */
    body: string;
    /** Raw `git show` diff */
    diff: string;
    /** Subjects of commits strictly BEFORE this one — no time-travel leakage */
    priorSubjects: string[];
}

export interface GoldenCorpus {
    repo: string;
    extractedAt: string;
    commits: GoldenCommit[];
}

export type EvalArm = 'enriched' | 'baseline';

/** A commit message split into its two comparable parts */
export interface MessageParts {
    subject: string;
    body: string;
}

export interface ConformanceScore {
    /** 1 when generated style matches the dominant repo style, null when no dominant style to judge against */
    styleMatch: number | null;
    /** Frequency-weighted validity of the generated type, null when history has no type signal */
    typeValid: number | null;
    /** 1 when generated scope is a common repo scope, null when history has no common scopes */
    scopeMatch: number | null;
    /** 1 - clamped relative deviation from the historical mean subject length */
    lengthScore: number;
    /** Weighted mean over non-null components, 0..1 */
    total: number;
}

export interface SimilarityScore {
    /** Content-word Jaccard between generated and real subjects (conventional prefixes stripped) */
    subjectOverlap: number;
    /** Content-word Jaccard between bodies, null when the real commit has no body */
    bodyOverlap: number | null;
    total: number;
}

export interface CommitEvalResult {
    sha: string;
    arm: EvalArm;
    generatedSubject: string;
    generatedBody: string;
    conformance?: ConformanceScore;
    similarity?: SimilarityScore;
    /** Generated type === real type; null when the real subject is not conventional */
    typeAgreement: boolean | null;
    /** Set when generation failed — excluded from aggregates */
    error?: string;
}

export interface ArmAggregate {
    count: number;
    meanConformance: number;
    meanSimilarity: number;
    /** Agreement rate over commits where typeAgreement is non-null */
    typeAgreementRate: number;
    failures: number;
}

export interface EvalReport {
    corpus: { repo: string; size: number };
    model: string;
    results: CommitEvalResult[];
    aggregate: Record<EvalArm, ArmAggregate>;
    /** enriched − baseline: the headline numbers */
    delta: { conformance: number; similarity: number; typeAgreement: number };
}
