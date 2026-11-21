import path from 'node:path';
import { KG_ROOT, DEFAULT_BANK_ROOT, loadOntology, loadPaperAnnotations, readJson } from '../src/loader.mjs';
import { validateOntology, validatePaperAnnotation } from '../src/validator.mjs';

const ontology = loadOntology(KG_ROOT);
const ontoRes = validateOntology(ontology);
if (!ontoRes.ok) {
  console.error('本体校验失败:');
  for (const err of ontoRes.errors) console.error('  -', err);
  process.exit(1);
}

const annotations = loadPaperAnnotations(KG_ROOT);
const annErrors = [];
for (const [paperId, ann] of annotations.entries()) {
  const bankPaperPath = path.join(DEFAULT_BANK_ROOT, 'public', 'data', 'papers', `${paperId}.json`);
  const bankPaper = readJson(bankPaperPath);
  const res = validatePaperAnnotation(ann, ontology, bankPaper);
  if (!res.ok) {
    for (const err of res.errors) annErrors.push(`[${paperId}] ${err}`);
  }
}

if (annErrors.length > 0) {
  console.error('试卷图谱挂载校验失败:');
  for (const err of annErrors) console.error('  -', err);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      ontology_version: ontology.meta.ontology_version,
      counts: ontoRes.counts,
      validated_annotated_papers: annotations.size
    },
    null,
    2
  )
);
