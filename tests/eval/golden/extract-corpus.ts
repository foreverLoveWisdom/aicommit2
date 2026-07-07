/**
 * Golden-corpus extractor.
 *
 * Snapshots real commits (diff + human message + prior-history subjects)
 * into corpus.json so the eval stays stable as the repo grows.
 *
 * Usage: pnpm eval:corpus [repoPath=.] [count=30]
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { execa } from 'execa';

import type { GoldenCommit, GoldenCorpus } from './types.js';

const DEFAULT_COUNT = 30;
const SCAN_POOL = 500;
const PRIOR_SUBJECT_COUNT = 20;
const MAX_DIFF_CHARS = 200_000;
const NOISE_PATTERN = /chore\(release\)|\[skip ci\]/;

const CORPUS_PATH = fileURLToPath(new URL('corpus.json', import.meta.url));

const git = async (repoPath: string, args: string[]): Promise<string> => {
    const { stdout } = await execa('git', ['-C', repoPath, ...args]);
    return stdout;
};

const readCommit = async (repoPath: string, sha: string): Promise<GoldenCommit | null> => {
    // %x00 separator: one git call for subject + body instead of two
    const meta = await git(repoPath, ['log', '-1', '--format=%s%x00%b', sha]);
    const [subject, rawBody = ''] = meta.split('\0');
    if (NOISE_PATTERN.test(subject)) {
        return null;
    }

    const diff = await git(repoPath, ['show', '--format=', sha]);
    const isUsableDiff = diff.trim().length > 0 && diff.length <= MAX_DIFF_CHARS;
    if (!isUsableDiff) {
        return null;
    }

    // Prior history only — scoring against the profile the commit author "saw".
    let priorSubjects: string[] = [];
    try {
        const prior = await git(repoPath, ['log', '--format=%s', `-${PRIOR_SUBJECT_COUNT}`, `${sha}~1`]);
        priorSubjects = prior.split('\n').filter(Boolean);
    } catch {
        return null; // root commit — nothing to learn a profile from
    }
    if (priorSubjects.length === 0) {
        return null;
    }

    return { sha, subject, body: rawBody.trim(), diff, priorSubjects };
};

const extractCorpus = async (repoPath: string, count: number): Promise<GoldenCorpus> => {
    const pool = (await git(repoPath, ['log', '--no-merges', `-${SCAN_POOL}`, '--format=%H'])).split('\n').filter(Boolean);
    const repoName = path.basename(path.resolve(repoPath));

    const commits: GoldenCommit[] = [];
    for (const sha of pool) {
        if (commits.length >= count) {
            break;
        }
        const commit = await readCommit(repoPath, sha);
        if (commit) {
            commits.push(commit);
        }
    }

    return { repo: repoName, extractedAt: new Date().toISOString(), commits };
};

const main = async () => {
    const repoPath = process.argv[2] || '.';
    const count = Number(process.argv[3]) || DEFAULT_COUNT;

    const corpus = await extractCorpus(repoPath, count);
    if (corpus.commits.length === 0) {
        console.error('No usable commits found — is this a git repo with history?');
        process.exitCode = 1;
        return;
    }

    await fs.writeFile(CORPUS_PATH, JSON.stringify(corpus, null, 2));
    console.log(`Extracted ${corpus.commits.length} commits from ${corpus.repo} → ${CORPUS_PATH}`);
};

await main();
