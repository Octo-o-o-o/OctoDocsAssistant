export function languageOption(args = []) {
  const index = args.indexOf('--language');
  const value = index >= 0 ? args[index + 1] : null;
  if (!value) return {};
  if (!['zh', 'en'].includes(value)) {
    const error = new Error('Invalid --language value. Expected `zh` or `en`.');
    error.code = 'INVALID_LANGUAGE';
    throw error;
  }
  return { language: value };
}

export function progressOption(args = []) {
  if (!args.includes('--progress')) return {};
  return {
    onProgress(event) {
      const parts = ['[octodocs]', event.phase || 'progress'];
      if (event.current != null && event.total != null) parts.push(`${event.current}/${event.total}`);
      if (event.path) parts.push(event.path);
      if (event.message) parts.push(event.message);
      process.stderr.write(`${parts.join(' ')}\n`);
    }
  };
}
