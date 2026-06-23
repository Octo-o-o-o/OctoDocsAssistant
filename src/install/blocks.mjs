import { readTextIfExists, writeText } from '../utils/fs.mjs';

export async function upsertMarkedBlock(filePath, id, body) {
  const start = `<!-- octodocs:${id} start -->`;
  const end = `<!-- octodocs:${id} end -->`;
  const block = `${start}\n${body.trim()}\n${end}`;
  const existing = await readTextIfExists(filePath);
  if (!existing) {
    await writeText(filePath, `${block}\n`);
    return { written: true, changed: true };
  }
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);
  if (startIndex >= 0 && endIndex > startIndex) {
    const next = `${existing.slice(0, startIndex)}${block}${existing.slice(endIndex + end.length)}`;
    if (next === existing) return { written: true, changed: false };
    await writeText(filePath, next);
    return { written: true, changed: true };
  }
  await writeText(filePath, `${existing.trimEnd()}\n\n${block}\n`);
  return { written: true, changed: true };
}
