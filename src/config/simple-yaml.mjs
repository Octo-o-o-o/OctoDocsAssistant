function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map(parseScalar);
  }
  return trimmed;
}

export function parseSimpleYaml(text) {
  const jsonText = text.trim();
  if (!jsonText) return {};
  if (jsonText.startsWith('{')) return JSON.parse(jsonText);

  const lines = text.split('\n');
  // Strip line comments: a `#` at line start (after indent) or preceded by whitespace.
  // `a#b` (no whitespace before #) is preserved so anchors like file.ts#sym survive.
  const stripComment = (line) => line.replace(/(^\s*|\s+)#.*$/, '');
  // Root container is a sequence if the first content line begins with "- ", else a mapping.
  let reparsed = {};
  for (const candidate of lines) {
    const content = stripComment(candidate).trim();
    if (!content) continue;
    if (content.startsWith('- ')) reparsed = [];
    break;
  }
  const pathStack = [{ indent: -1, value: reparsed }];
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const withoutComment = stripComment(rawLine);
    if (!withoutComment.trim()) continue;
    const indent = withoutComment.match(/^ */)[0].length;
    const line = withoutComment.trim();
    while (pathStack.length > 1 && indent <= pathStack.at(-1).indent) pathStack.pop();
    const frame = pathStack.at(-1);

    if (line.startsWith('- ')) {
      if (!Array.isArray(frame.value)) throw new Error(`Invalid sequence indentation near "${line}"`);
      frame.value.push(parseScalar(line.slice(2)));
      continue;
    }

    const separator = line.indexOf(':');
    if (separator === -1) throw new Error(`Expected key: value near "${line}"`);
    const key = line.slice(0, separator).trim();
    const rest = line.slice(separator + 1).trim();
    if (rest) {
      frame.value[key] = parseScalar(rest);
      continue;
    }
    const nextLine = lines.slice(index + 1).find((candidate) => candidate.trim());
    const isArray = nextLine && nextLine.match(/^ */)[0].length > indent && nextLine.trim().startsWith('- ');
    const child = isArray ? [] : {};
    frame.value[key] = child;
    pathStack.push({ indent, value: child });
  }

  return reparsed;
}

function quoteString(value) {
  return JSON.stringify(value);
}

export function stringifySimpleYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]`;
    return value.map((item) => `${pad}- ${typeof item === 'object' ? JSON.stringify(item) : quoteString(item)}`).join('\n');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, child]) => {
        if (Array.isArray(child)) {
          if (!child.length) return `${pad}${key}: []`;
          return `${pad}${key}:\n${stringifySimpleYaml(child, indent + 2)}`;
        }
        if (child && typeof child === 'object') {
          return `${pad}${key}:\n${stringifySimpleYaml(child, indent + 2)}`;
        }
        if (typeof child === 'string') return `${pad}${key}: ${quoteString(child)}`;
        return `${pad}${key}: ${String(child)}`;
      })
      .join('\n');
  }
  return `${pad}${String(value)}`;
}
