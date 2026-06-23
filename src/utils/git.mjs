import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function gitInfo(root) {
  try {
    const branch = (await execFileAsync('git', ['branch', '--show-current'], { cwd: root })).stdout.trim() || 'detached';
    const commit = (await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root })).stdout.trim();
    return { git_repo: true, branch, commit };
  } catch {
    return { git_repo: false, branch: 'no-git', commit: 'none' };
  }
}
