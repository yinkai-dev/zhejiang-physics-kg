import path from 'node:path';
import { createRequire } from 'node:module';
import { KG_ROOT, DEFAULT_BANK_ROOT, loadOntology } from '../src/loader.mjs';

const require = createRequire(import.meta.url);
const rendererEntry = path.join(DEFAULT_BANK_ROOT, 'node_modules', 'mathjax', 'es5', 'node-main.js');
const { init } = require(rendererEntry);

const math = await init({
  loader: { load: ['input/tex-full', 'output/svg'] },
  startup: { typeset: false },
  svg: { fontCache: 'none' }
});

const renderError = /data-mjx-error|merror|fill="red"/;
const ontology = loadOntology(KG_ROOT);
const formulas = [];

for (const law of ontology.laws) {
  for (const f of law.formulas || []) {
    formulas.push({ owner: law.id, latex: f });
  }
}

const errors = [];
for (const item of formulas) {
  const html = math.startup.adaptor.outerHTML(math.tex2svg(item.latex, { display: true }));
  if (renderError.test(html)) {
    errors.push({ owner: item.owner, latex: item.latex, html });
  }
}

if (errors.length > 0) {
  console.error('本体公式 MathJax 校验存在错误:', JSON.stringify(errors, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checked_formulas: formulas.length, errors: 0 }, null, 2));
