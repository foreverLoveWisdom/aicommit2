import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { isSeq, parseDocument } from 'yaml';

import { ConsoleManager } from '../managers/console.manager.js';
import { KnownError } from '../utils/error.js';
import { findLazygitConfig, isLazygitInstalled } from '../utils/lazygit.js';

const consoleManager = new ConsoleManager();

export type LazygitSetupMode = 'simple' | 'fzf';

export interface LazygitSetupOptions {
    mode: LazygitSetupMode;
    key?: string;
    force: boolean;
}

const FZF_SCRIPT_NAME = 'aicommit_fzf.sh';

// Based on @peinan's configuration (https://github.com/tak-bro/aicommit2/issues/215)
const FZF_SCRIPT_CONTENT = `#!/usr/bin/env bash
set -euo pipefail

for cmd in aicommit2 jq fzf; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "$cmd is required"
    exit 1
  fi
done

results_file="$(mktemp -t lazygit-aicommit-results.XXXXXX)"
trap 'rm -f "$results_file"' EXIT INT TERM

selected="$(
  echo | fzf \\
    --prompt="AI commit> " \\
    --header="Select a message" \\
    --height=100% \\
    --layout=reverse \\
    --info=inline \\
    --with-nth=2.. \\
    --delimiter=$'\\t' \\
    --with-shell="bash --noprofile --norc -c" \\
    --preview-window="right:60%:wrap" \\
    --preview "jq -r '.[ {1} ] | \\"\\(.subject)\\n\\n\\(.body)\\"' $results_file" \\
    --bind "load:unbind(load)+reload-sync#aicommit2 -i --output json 2>/dev/null | jq -s '.' > $results_file && jq -r 'to_entries[] | \\"\\\\(.key)\\\\t\\\\(.value.subject)\\"' $results_file#"
)" || exit 0

[ -n "$selected" ] || exit 0

index="\${selected%%$'\\t'*}"
subject="$(jq -r ".[$index].subject" "$results_file")"
body="$(jq -r ".[$index].body" "$results_file")"

git commit -e -m "$subject" -m "$body"
`;

const commandExists = (command: string): boolean => {
    try {
        execSync(`${command} --version`, { stdio: ['ignore', 'pipe', 'pipe'] });
        return true;
    } catch {
        return false;
    }
};

const buildCustomCommandEntry = (options: LazygitSetupOptions, configDir: string): Record<string, string> => {
    if (options.mode === 'fzf') {
        return {
            key: options.key || 'C',
            context: 'files',
            description: 'Generate commit message (long) with aicommit2',
            command: path.join(configDir, 'scripts', FZF_SCRIPT_NAME),
            output: 'terminal',
        };
    }

    return {
        key: options.key || 'c',
        context: 'files',
        description: 'Generate commit message with aicommit2',
        command: 'aicommit2',
        output: 'terminal',
    };
};

const writeFzfScript = (configDir: string): string => {
    const scriptsDir = path.join(configDir, 'scripts');
    const scriptPath = path.join(scriptsDir, FZF_SCRIPT_NAME);

    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(scriptPath, FZF_SCRIPT_CONTENT, 'utf8');
    if (process.platform !== 'win32') {
        fs.chmodSync(scriptPath, 0o755);
    }

    return scriptPath;
};

const entryReferencesAicommit = (item: unknown): boolean => {
    const node = item as { toJSON?: () => unknown };
    const json = typeof node?.toJSON === 'function' ? node.toJSON() : item;
    return JSON.stringify(json ?? '').includes('aicommit2');
};

const backupConfig = (configPath: string): string => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${configPath}.${timestamp}.aicommit2.bak`;
    fs.copyFileSync(configPath, backupPath);
    return backupPath;
};

export const runLazygitSetup = async (options: LazygitSetupOptions): Promise<void> => {
    if (options.mode !== 'simple' && options.mode !== 'fzf') {
        throw new KnownError(`Unknown mode: ${options.mode}. Supported modes: simple, fzf`);
    }

    if (!isLazygitInstalled()) {
        consoleManager.printWarning('lazygit binary not found on PATH. Configuration will still be written.');
    }

    if (options.mode === 'fzf') {
        const missing = ['jq', 'fzf'].filter(cmd => !commandExists(cmd));
        if (missing.length > 0) {
            consoleManager.printWarning(`Required for fzf mode but not found: ${missing.join(', ')} (brew install ${missing.join(' ')})`);
        }
    }

    const location = findLazygitConfig();
    const configDir = path.dirname(location.path);
    const content = location.exists ? fs.readFileSync(location.path, 'utf8') : '';

    const doc = parseDocument(content);
    if (doc.errors.length > 0) {
        throw new KnownError(`Failed to parse lazygit config at ${location.path}: ${doc.errors[0].message}`);
    }

    const customCommands = doc.get('customCommands');
    if (customCommands != null && !isSeq(customCommands)) {
        throw new KnownError(`customCommands in ${location.path} is not a list. Please fix the config manually.`);
    }

    const existingEntries = isSeq(customCommands) ? customCommands.items.filter(entryReferencesAicommit) : [];
    if (existingEntries.length > 0 && !options.force) {
        consoleManager.printInfo(`aicommit2 is already configured in ${location.path}`);
        consoleManager.printInfo('Use `aicommit2 setup lazygit --force` to overwrite the existing integration.');
        return;
    }

    if (location.exists) {
        const backupPath = backupConfig(location.path);
        consoleManager.printInfo(`Backed up existing config to ${backupPath}`);
    }

    if (options.mode === 'fzf') {
        const scriptPath = writeFzfScript(configDir);
        consoleManager.printInfo(`Installed fzf helper script at ${scriptPath}`);
    }

    const entry = buildCustomCommandEntry(options, configDir);
    if (isSeq(customCommands)) {
        if (options.force) {
            customCommands.items = customCommands.items.filter(item => !entryReferencesAicommit(item));
        }
        customCommands.add(doc.createNode(entry));
    } else {
        doc.set('customCommands', doc.createNode([entry]));
    }

    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(location.path, doc.toString(), 'utf8');

    consoleManager.printSuccess(`lazygit integration added to ${location.path}`);
    consoleManager.printInfo(`Open lazygit and press \`${entry.key}\` in the Files panel to generate commit messages.`);
    if (entry.key === 'c') {
        consoleManager.printInfo('Note: this overrides the default `c` (commit) key. Re-run with `--key <key>` to use a different key.');
    }
};
