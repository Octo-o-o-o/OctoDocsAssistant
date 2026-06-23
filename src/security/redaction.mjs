const SECRET_PATTERNS = [
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?([A-Za-z0-9._\-+/=]{8,})["']?/gi,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g
];

export function redactSecrets(text) {
  let redacted = String(text || '');
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      if (/-----BEGIN/.test(match)) return '[REDACTED_PRIVATE_KEY]';
      const prefix = match.split(/[:=]/)[0];
      return `${prefix}: [REDACTED_SECRET]`;
    });
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
