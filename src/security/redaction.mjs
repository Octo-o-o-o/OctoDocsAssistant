// Order matters: whole PEM blocks first, then key/value pairs (keep the key
// name), then bare tokens (replace the entire match — a bare token has no
// key prefix that would be safe to echo back).
const SECRET_REDACTIONS = [
  {
    pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
    replace: () => '[REDACTED_PRIVATE_KEY]'
  },
  {
    pattern: /(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?([A-Za-z0-9._\-+/=]{8,})["']?/gi,
    replace: (match) => `${match.split(/[:=]/)[0].trim()}: [REDACTED_SECRET]`
  },
  {
    pattern: /sk-[A-Za-z0-9_-]{20,}/g,
    replace: () => '[REDACTED_SECRET]'
  },
  {
    // GitHub personal/app tokens (classic and fine-grained).
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replace: () => '[REDACTED_SECRET]'
  },
  {
    // AWS access key IDs.
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replace: () => '[REDACTED_SECRET]'
  },
  {
    // Slack tokens.
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replace: () => '[REDACTED_SECRET]'
  },
  {
    // Google API keys.
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replace: () => '[REDACTED_SECRET]'
  }
];

export function redactSecrets(text) {
  let redacted = String(text || '');
  for (const { pattern, replace } of SECRET_REDACTIONS) {
    redacted = redacted.replace(pattern, replace);
  }
  return redacted;
}

export function wrapUntrusted({ path, content }) {
  return {
    source: 'repo',
    path,
    content: redactSecrets(content)
  };
}
