/**
 * Golden-eval runner.
 *
 * For each corpus commit, regenerates the message from the diff in two arms
 * (context-enriched vs baseline) via the Claude Code CLI, scores both against
 * the real human-written message, and reports the enriched−baseline delta.
 *
 * Usage: pnpm eval:golden [-- --limit 5] [--model sonnet]
 * Needs: `claude` CLI logged in. No API keys.
 */
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import { assertClaudeCliAvailable, createClaudeCodeGenerator } from './providers.js';
import { parseConventionalType, scoreConformance, scoreSimilarity } from './scorers/index.js';
import { buildCommitContext } from '../../../src/utils/commit-context/index.js';
import { DEFAULT_PROMPT_OPTIONS, generatePrompt, generateUserPrompt } from '../../../src/utils/prompt.js';
import { safeJsonParse } from '../../../src/utils/utils.js';

import type { ArmAggregate, CommitEvalResult, EvalArm, EvalReport, GoldenCommit, GoldenCorpus, MessageParts } from './types.js';

const CORPUS_PATH = fileURLToPath(new URL('corpus.json', import.meta.url));
const REPORT_JSON_PATH = fileURLToPath(new URL('report.json', import.meta.url));
const REPORT_MD_PATH = fileURLToPath(new URL('report.md', import.meta.url));

const DEFAULT_MODEL = process.env.EVAL_MODEL || 'sonnet';
const GENERATION_TIMEOUT_MS = 120_000;

interface CliOptions {
    limit: number;
    model: string;
}

const parseArgs = (argv: string[]): CliOptions => {
    const options: CliOptions = { limit: Infinity, model: DEFAULT_MODEL };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--limit') {
            const limit = Number(argv[++i]);
            options.limit = Number.isFinite(limit) && limit > 0 ? limit : Infinity;
        }
        if (argv[i] === '--model') {
            options.model = argv[++i] || DEFAULT_MODEL;
        }
    }
    return options;
};

const parseGeneratedMessage = (raw: string): MessageParts => {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = (fenced ? fenced[1] : raw).trim();
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));

    if (start !== -1 && end > start) {
        const parseResult = safeJsonParse(candidate.slice(start, end + 1));
        const first: unknown = parseResult.ok ? (Array.isArray(parseResult.data) ? parseResult.data[0] : parseResult.data) : null;
        if (first && typeof first === 'object' && typeof (first as { subject?: unknown }).subject === 'string') {
            // body is model-emitted JSON — degrade non-strings to '' instead of throwing,
            // so shape drift never masquerades as a generation failure in the aggregate.
            const { subject, body } = first as { subject: string; body?: unknown };
            return { subject: subject.trim(), body: typeof body === 'string' ? body.trim() : '' };
        }
    }

    const [firstLine = '', ...rest] = candidate.split('\n');
    return { subject: firstLine.trim(), body: rest.join('\n').trim() };
};

const loadCorpus = async (): Promise<GoldenCorpus> => {
    const raw = await fs.readFile(CORPUS_PATH, 'utf8').catch(() => {
        throw new Error(`corpus.json not found — run \`pnpm eval:corpus\` first (expected at ${CORPUS_PATH})`);
    });
    const parsed = safeJsonParse(raw);
    const hasCommitList = parsed.ok && Array.isArray((parsed.data as GoldenCorpus).commits);
    if (!hasCommitList) {
        throw new Error('corpus.json is malformed — re-run `pnpm eval:corpus`');
    }
    return parsed.data as GoldenCorpus;
};

const buildUserPromptForArm = (commit: GoldenCommit, arm: EvalArm): string => {
    const context = arm === 'enriched' ? buildCommitContext({ recentCommits: commit.priorSubjects.join('\n'), branchName: '' }) : undefined;
    return generateUserPrompt(commit.diff, 'commit', context);
};

const scoreResult = (commit: GoldenCommit, arm: EvalArm, generated: MessageParts): CommitEvalResult => {
    const realType = parseConventionalType(commit.subject);
    const generatedType = parseConventionalType(generated.subject);
    return {
        sha: commit.sha,
        arm,
        generatedSubject: generated.subject,
        generatedBody: generated.body,
        conformance: scoreConformance(generated.subject, commit.priorSubjects),
        similarity: scoreSimilarity(generated, { subject: commit.subject, body: commit.body }),
        typeAgreement: realType === null ? null : generatedType === realType,
    };
};

const aggregateArm = (results: CommitEvalResult[], arm: EvalArm): ArmAggregate => {
    const armResults = results.filter(result => result.arm === arm);
    const scored = armResults.filter(result => !result.error);
    const judged = scored.filter(result => result.typeAgreement !== null);

    const mean = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);

    return {
        count: scored.length,
        meanConformance: mean(scored.map(result => result.conformance?.total ?? 0)),
        meanSimilarity: mean(scored.map(result => result.similarity?.total ?? 0)),
        typeAgreementRate: judged.length === 0 ? 0 : judged.filter(result => result.typeAgreement).length / judged.length,
        failures: armResults.length - scored.length,
    };
};

const formatPct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const formatDelta = (value: number): string => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}pp`;

const renderMarkdown = (report: EvalReport, commits: GoldenCommit[]): string => {
    const { enriched, baseline } = report.aggregate;
    const lines = [
        `# Golden Eval Report — ${report.corpus.repo}`,
        '',
        `Model: \`${report.model}\` · Commits: ${report.corpus.size} · Arms: enriched (context on) vs baseline (context off)`,
        '',
        '## Headline: enrichment delta (enriched − baseline)',
        '',
        `| Metric | Baseline | Enriched | Delta |`,
        `|--------|----------|----------|-------|`,
        `| Conformance | ${formatPct(baseline.meanConformance)} | ${formatPct(enriched.meanConformance)} | **${formatDelta(report.delta.conformance)}** |`,
        `| Similarity | ${formatPct(baseline.meanSimilarity)} | ${formatPct(enriched.meanSimilarity)} | **${formatDelta(report.delta.similarity)}** |`,
        `| Type agreement | ${formatPct(baseline.typeAgreementRate)} | ${formatPct(enriched.typeAgreementRate)} | **${formatDelta(report.delta.typeAgreement)}** |`,
        '',
        `Failures: enriched ${enriched.failures}, baseline ${baseline.failures}`,
        '',
        '## Per-commit results',
        '',
        '| SHA | Arm | Generated subject | Conf | Sim | Type OK |',
        '|-----|-----|-------------------|------|-----|---------|',
    ];

    for (const result of report.results) {
        const conf = result.error ? '—' : formatPct(result.conformance?.total ?? 0);
        const sim = result.error ? '—' : formatPct(result.similarity?.total ?? 0);
        const typeOk = result.typeAgreement === null ? 'n/a' : result.typeAgreement ? '✓' : '✗';
        const subject = result.error ? `(failed: ${result.error})` : result.generatedSubject;
        lines.push(`| ${result.sha.slice(0, 7)} | ${result.arm} | ${subject.replace(/\|/g, '\\|')} | ${conf} | ${sim} | ${typeOk} |`);
    }

    lines.push('', '## Real subjects (answer key)', '');
    for (const commit of commits) {
        lines.push(`- \`${commit.sha.slice(0, 7)}\` ${commit.subject}`);
    }

    lines.push(
        '',
        '## Known limitations (v1)',
        '',
        '- Branch names are not recoverable from history — ticket/branch-intent context axes stay silent; this eval exercises the convention axis.',
        '- Conformance is self-consistent with the profile fed to the enriched arm; informativeness is carried by similarity + type agreement.',
        '- Similarity is content-word Jaccard — paraphrases score low; embedding similarity is a v2 option.'
    );
    return lines.join('\n');
};

const main = async () => {
    const options = parseArgs(process.argv.slice(2));
    await assertClaudeCliAvailable();

    const corpus = await loadCorpus();
    const commits = corpus.commits.slice(0, options.limit);
    const generate = createClaudeCodeGenerator(options.model, GENERATION_TIMEOUT_MS);
    const systemPrompt = generatePrompt(DEFAULT_PROMPT_OPTIONS);

    const results: CommitEvalResult[] = [];
    for (const [index, commit] of commits.entries()) {
        for (const arm of ['enriched', 'baseline'] as const) {
            const label = `[${index + 1}/${commits.length}] ${commit.sha.slice(0, 7)} ${arm}`;
            try {
                const raw = await generate(systemPrompt, buildUserPromptForArm(commit, arm));
                const result = scoreResult(commit, arm, parseGeneratedMessage(raw));
                results.push(result);
                console.log(`${label} → "${result.generatedSubject}"`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                results.push({ sha: commit.sha, arm, generatedSubject: '', generatedBody: '', typeAgreement: null, error: message });
                console.error(`${label} → FAILED: ${message}`);
            }
        }
    }

    const aggregate: Record<EvalArm, ArmAggregate> = {
        enriched: aggregateArm(results, 'enriched'),
        baseline: aggregateArm(results, 'baseline'),
    };
    const report: EvalReport = {
        corpus: { repo: corpus.repo, size: commits.length },
        model: options.model,
        results,
        aggregate,
        delta: {
            conformance: aggregate.enriched.meanConformance - aggregate.baseline.meanConformance,
            similarity: aggregate.enriched.meanSimilarity - aggregate.baseline.meanSimilarity,
            typeAgreement: aggregate.enriched.typeAgreementRate - aggregate.baseline.typeAgreementRate,
        },
    };

    await fs.writeFile(REPORT_JSON_PATH, JSON.stringify(report, null, 2));
    await fs.writeFile(REPORT_MD_PATH, renderMarkdown(report, commits));

    console.log(`\nConformance delta: ${formatDelta(report.delta.conformance)}`);
    console.log(`Similarity delta: ${formatDelta(report.delta.similarity)}`);
    console.log(`Type agreement delta: ${formatDelta(report.delta.typeAgreement)}`);
    console.log(`\nReports → ${REPORT_MD_PATH}`);
};

await main();
