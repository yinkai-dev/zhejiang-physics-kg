import fs from 'node:fs';
import path from 'node:path';
import { KG_ROOT, DEFAULT_BANK_ROOT, loadOntology, readJson } from '../src/loader.mjs';
import { validatePaperAnnotation } from '../src/validator.mjs';
import { readBankPaperSafely } from '../src/split-guard.mjs';

const args = process.argv.slice(2);
const inputPath = args.find((a) => !a.startsWith('--'));
const outDirIdx = args.indexOf('--out-dir');
const outDir = outDirIdx >= 0 ? path.resolve(KG_ROOT, args[outDirIdx + 1]) : path.join(KG_ROOT, 'annotations', 'papers');
const unlockHeldOutTest = args.includes('--unlock-heldout-test');

if (!inputPath) {
  console.error('用法: node scripts/save-paper-annotation.mjs <draft.json> [--out-dir <dir>] [--unlock-heldout-test]');
  process.exit(1);
}

const draft = readJson(path.resolve(inputPath));
const ontology = loadOntology(KG_ROOT);
const { paper } = readBankPaperSafely(draft.paper_id, {
  root: KG_ROOT,
  bankRoot: DEFAULT_BANK_ROOT,
  unlockHeldOutTest
});

const fpMap = new Map(paper.questions.map((q) => [q.id, q]));

// 自动回填最新 ontology_version 与权威 question_sha256，防止手填指纹失误
const normalized = {
  paper_id: paper.paper_id,
  ontology_version: ontology.meta.ontology_version,
  annotated_at: draft.annotated_at || new Date().toISOString(),
  annotator: draft.annotator || 'agent',
  questions: (draft.questions || []).map((q) => {
    const bq = fpMap.get(q.question_id);
    const hasAns = bq && (bq.answer_status === 'source' || Boolean(bq.ai_reference));
    return {
      question_id: q.question_id,
      question_sha256: bq ? bq.fingerprint : q.question_sha256,
      annotation_source: q.annotation_source || (hasAns ? 'answer_grounded_ai' : 'question_only_ai'),
      slot: q.slot,
      models: [...new Set(q.models || [])],
      laws: [...new Set(q.laws || [])],
      experiments: [...new Set(q.experiments || [])],
      exp_skills: [...new Set(q.exp_skills || [])],
      methods: [...new Set(q.methods || [])],
      traps: [...new Set(q.traps || [])],
      ...(q.subquestions ? { subquestions: q.subquestions } : {}),
      ...(q.oov_proposals?.length ? { oov_proposals: q.oov_proposals } : {})
    };
  })
};

const check = validatePaperAnnotation(normalized, ontology, paper);
if (!check.ok) {
  console.error(`试卷 ${paper.paper_id} 标注未通过门禁校验（共 ${check.errors.length} 处错误）：`);
  for (const e of check.errors) console.error('  -', e);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const targetFile = path.join(outDir, `${paper.paper_id}.json`);
fs.writeFileSync(targetFile, JSON.stringify(normalized, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, saved: targetFile, paper_id: paper.paper_id, questions: normalized.questions.length }, null, 2));
