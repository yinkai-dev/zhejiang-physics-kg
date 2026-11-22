import path from 'node:path';
import {
  KG_ROOT,
  DEFAULT_BANK_ROOT,
  loadOntology,
  loadPaperAnnotations,
  loadTextbookAnnotations,
  loadGaokaoProvenance,
  readJson
} from '../src/loader.mjs';
import {
  validateOntology,
  validatePaperAnnotation,
  validateTextbookBookAnnotation,
  validateGaokaoProvenance
} from '../src/validator.mjs';

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

const tbAnnotations = loadTextbookAnnotations(KG_ROOT);
const tbItemMap = new Map();
const tbErrors = [];
for (const [bookId, bookAnn] of tbAnnotations.entries()) {
  const res = validateTextbookBookAnnotation(bookAnn, ontology);
  if (!res.ok) {
    for (const err of res.errors) tbErrors.push(`[textbook:${bookId}] ${err}`);
  }
  for (const item of bookAnn.items || []) {
    tbItemMap.set(item.item_id, item);
  }
}

if (tbErrors.length > 0) {
  console.error('教材母题与栏目图谱挂载校验失败:');
  for (const err of tbErrors) console.error('  -', err);
  process.exit(1);
}

const provData = loadGaokaoProvenance(KG_ROOT);
let validatedProvenanceQuestions = 0;
if (provData) {
  const pRes = validateGaokaoProvenance(provData, tbItemMap, ontology);
  if (!pRes.ok) {
    console.error('浙江高考真题教材溯源校验失败:');
    for (const err of pRes.errors) console.error('  -', err);
    process.exit(1);
  }
  validatedProvenanceQuestions = provData.papers.reduce((s, p) => s + (p.questions?.length || 0), 0);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      ontology_version: ontology.meta.ontology_version,
      counts: ontoRes.counts,
      validated_annotated_papers: annotations.size,
      validated_textbook_books: tbAnnotations.size,
      validated_textbook_items: tbItemMap.size,
      validated_gaokao_provenance_questions: validatedProvenanceQuestions
    },
    null,
    2
  )
);
