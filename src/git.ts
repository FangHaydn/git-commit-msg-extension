import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface RepoDiff {
  source: 'staged' | 'working-tree';
  text: string;
}

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(new Error(`git ${args[0]} failed: ${stderr || error.message}`), {
            code: (error as NodeJS.ErrnoException).code,
          }));
        } else {
          resolve(stdout);
        }
      }
    );
  });
}

export async function getRepoRoot(cwd: string): Promise<string> {
  const root = await execGit(['rev-parse', '--show-toplevel'], cwd);
  return root.trim();
}

export async function hasStagedChanges(repoRoot: string): Promise<boolean> {
  try {
    await execGit(['diff', '--cached', '--quiet'], repoRoot);
    return false;
  } catch (error) {
    const exitCode = (error as { code?: unknown }).code;
    // git diff --quiet exits with code 1 when differences exist.
    if (exitCode === 1) {
      return true;
    }
    throw error;
  }
}

async function getTrackedDiff(repoRoot: string, staged: boolean): Promise<string> {
  const args = staged
    ? ['diff', '--cached', '--no-color']
    : ['diff', '--no-color'];
  return execGit(args, repoRoot);
}

async function getUntrackedFilesDiff(repoRoot: string, maxBytesPerFile: number): Promise<string> {
  const files = (await execGit(['ls-files', '--others', '--exclude-standard'], repoRoot))
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  const parts: string[] = [];
  for (const file of files.slice(0, 50)) {
    try {
      const content = await fs.readFile(path.join(repoRoot, file), 'utf8');
      const truncated = content.slice(0, maxBytesPerFile)
        .split('\n')
        .map((line) => `+${line}`)
        .join('\n');
      parts.push(
        `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n${truncated}`
      );
    } catch {
      parts.push(`diff --git a/${file} b/${file}\nnew file mode 100644\n(binary or unreadable)`);
    }
  }
  return parts.join('\n');
}

export async function collectDiff(repoRoot: string): Promise<RepoDiff> {
  if (await hasStagedChanges(repoRoot)) {
    return { source: 'staged', text: await getTrackedDiff(repoRoot, true) };
  }

  const [tracked, untracked] = await Promise.all([
    getTrackedDiff(repoRoot, false),
    getUntrackedFilesDiff(repoRoot, 8 * 1024),
  ]);
  const text = [tracked, untracked].filter(Boolean).join('\n');
  return { source: 'working-tree', text };
}
