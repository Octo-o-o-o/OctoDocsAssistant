import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

export async function ensureParent(filePath) {
  await ensureDir(dirname(filePath));
}

export async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeText(filePath, text) {
  await ensureParent(filePath);
  await writeFile(filePath, text, 'utf8');
}

export function toPosixPath(path) {
  return path.replaceAll('\\', '/');
}
