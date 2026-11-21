import fs from 'node:fs';
import path from 'node:path';
import { KG_ROOT, DEFAULT_BANK_ROOT, readJson } from '../src/loader.mjs';
import { loadBundle } from '../src/engine.mjs';
import {
  evaluateOovRate,
  evaluateAnnotationComparison,
  auditZeroOutOfScopeSafety
} from '../src/evaluator.mjs';

function loadDirPapers(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJson(path.join(dirPath, f)));
}

const args = process.argv.slice(2);
const dirAIdx = args.indexOf('--dir-a');
const dirBIdx = args.indexOf('--dir-b');
const oovDirIdx = args.indexOf('--oov-dir');
const auditScope = args.includes('--audit-scope');

const bundle = loadBundle(KG_ROOT);
const output = {};

if (oovDirIdx >= 0) {
  const papers = loadDirPapers(path.resolve(KG_ROOT, args[oovDirIdx + 1]));
  output.oov = evaluateOovRate(papers);
}

if (dirAIdx >= 0 && dirBIdx >= 0) {
  const papersA = loadDirPapers(path.resolve(KG_ROOT, args[dirAIdx + 1]));
  const papersB = loadDirPapers(path.resolve(KG_ROOT, args[dirBIdx + 1]));
  output.comparison = evaluateAnnotationComparison(papersA, papersB, bundle);
}

if (auditScope) {
  const qIndex = readJson(path.join(DEFAULT_BANK_ROOT, 'public', 'data', 'questions-index.json'));
  const bankQMap = new Map(qIndex.questions.map((q) => [q.id, { text: q.search_text }]));
  output.zero_out_of_scope_audit = auditZeroOutOfScopeSafety(bundle, bankQMap);
}

console.log(JSON.stringify(output, null, 2));
