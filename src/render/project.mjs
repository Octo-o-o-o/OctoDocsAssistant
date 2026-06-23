import { renderPhase0 } from './phase0.mjs';
import { renderPhase1 } from './phase1.mjs';
import { renderHtmlViews } from './html-view.mjs';
import { renderProductViews } from './product.mjs';

export async function renderProjectViews(root, options = {}) {
  const phase0 = await renderPhase0(root, options);
  const phase1 = await renderPhase1(root, options);
  const product = await renderProductViews(root, options);
  const html = await renderHtmlViews(root, options);
  return {
    files: [...phase0.files, ...phase1.files, ...product.files, ...html.files],
    warnings: [...phase0.warnings, ...phase1.warnings, ...product.warnings]
  };
}
