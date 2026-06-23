import { ok } from '../agent/output.mjs';
import { installAgentHooks } from '../install/agents.mjs';
import { installGitHooks, uninstallGitHooks } from '../install/git.mjs';

export async function installCommand({ root, args }) {
  if (args.includes('--uninstall')) {
    const git = await uninstallGitHooks(root);
    return ok({ git }, ['Git hooks removed when they were owned by OctoDocs.', 'Agent rule files are left in place; edit/remove marked blocks manually if desired.']);
  }
  const git = await installGitHooks(root);
  const agents = await installAgentHooks(root);
  return ok(
    { git, agents, background_llm_called: false },
    [
      'Hooks are enqueue-only. Run `octodocs status` after commits to see pending work.',
      'Run `octodocs install` again to verify idempotence.',
      'Use `octodocs install --uninstall` to remove git hooks installed by OctoDocs.'
    ]
  );
}
