import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function lastCommitTs(root, path) {
  try {
    const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%aI', '--', path], { cwd: root });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function gitAgeSignal(root, docPath, referencedPath) {
  const docTs = await lastCommitTs(root, docPath);
  const refTs = await lastCommitTs(root, referencedPath);
  if (!docTs || !refTs) {
    return { type: 'git_age', doc_path: docPath, referenced_path: referencedPath, status: 'unknown', age_days: null };
  }
  const ageDays = Math.round((new Date(refTs).getTime() - new Date(docTs).getTime()) / 86400000);
  return {
    type: 'git_age',
    doc_path: docPath,
    referenced_path: referencedPath,
    status: ageDays > 30 ? 'code_newer_than_doc' : 'fresh_enough',
    age_days: ageDays,
    doc_ts: docTs,
    referenced_ts: refTs
  };
}
