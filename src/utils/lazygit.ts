import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface LazygitConfigLocation {
    path: string;
    exists: boolean;
}

/**
 * Candidate lazygit config paths in resolution order.
 * Mirrors lazygit's own config dir resolution: LG_CONFIG_FILE env,
 * XDG_CONFIG_HOME, then platform defaults.
 * https://github.com/jesseduffield/lazygit/blob/master/docs/Config.md
 */
const getCandidateConfigPaths = (): string[] => {
    const home = os.homedir();
    const candidates: string[] = [];

    const xdgConfigHome = process.env.XDG_CONFIG_HOME;
    if (xdgConfigHome?.trim()) {
        candidates.push(path.join(xdgConfigHome, 'lazygit', 'config.yml'));
    }

    if (process.platform === 'darwin') {
        candidates.push(path.join(home, 'Library', 'Application Support', 'lazygit', 'config.yml'));
        candidates.push(path.join(home, '.config', 'lazygit', 'config.yml'));
    } else if (process.platform === 'win32') {
        if (process.env.APPDATA) {
            candidates.push(path.join(process.env.APPDATA, 'lazygit', 'config.yml'));
        }
        if (process.env.LOCALAPPDATA) {
            candidates.push(path.join(process.env.LOCALAPPDATA, 'lazygit', 'config.yml'));
        }
    } else {
        candidates.push(path.join(home, '.config', 'lazygit', 'config.yml'));
    }

    return [...new Set(candidates)];
};

/**
 * Finds the lazygit config file. Prefers an existing file among the
 * candidates; falls back to the first candidate path for creation.
 */
export const findLazygitConfig = (): LazygitConfigLocation => {
    // An explicit LG_CONFIG_FILE always wins, whether or not the file exists yet.
    // It may be a comma-separated list; the first file is the primary one.
    const envConfigFile = process.env.LG_CONFIG_FILE;
    if (envConfigFile?.trim()) {
        const envPath = envConfigFile.split(',')[0].trim();
        return { path: envPath, exists: fs.existsSync(envPath) };
    }

    const candidates = getCandidateConfigPaths();
    const existing = candidates.find(candidate => fs.existsSync(candidate));
    return { path: existing ?? candidates[0], exists: !!existing };
};

export const isLazygitInstalled = (): boolean => {
    try {
        execSync('lazygit --version', { stdio: ['ignore', 'pipe', 'pipe'] });
        return true;
    } catch {
        return false;
    }
};

/**
 * Checks whether a lazygit config file already references aicommit2
 * in its customCommands section.
 */
export const hasAicommitIntegration = (configPath: string): boolean => {
    try {
        const content = fs.readFileSync(configPath, 'utf8');
        return content.includes('aicommit2');
    } catch {
        return false;
    }
};
