import fs from 'node:fs';
import path from 'node:path';
import { KG_ROOT, DEFAULT_BANK_ROOT, readJson, sha256 } from '../src/loader.mjs';

const bankRoot = DEFAULT_BANK_ROOT;
const catalog = readJson(path.join(bankRoot, 'public', 'data', 'catalog.json'));
const qIndex = readJson(path.join(bankRoot, 'public', 'data', 'questions-index.json'));

const qByPaper = new Map();
for (const q of qIndex.questions) {
  if (!qByPaper.has(q.paper_id)) qByPaper.set(q.paper_id, []);
  qByPaper.get(q.paper_id).push({ id: q.id, number: q.number, type: q.type, fingerprint: q.fingerprint });
}

const SALT = 'zhejiang-physics-kg-splits-v1';
const deterministicSort = (arr) =>
  [...arr].sort((a, b) => sha256(`${SALT}:${a.paper_id}`).localeCompare(sha256(`${SALT}:${b.paper_id}`)));

const assigned = new Map();
const assign = (papers, split, reason) => {
  for (const p of papers) {
    if (assigned.has(p.paper_id)) throw new Error(`重复分配试卷: ${p.paper_id}`);
    assigned.set(p.paper_id, { split, reason });
  }
};

// 1. Test-OOD (10 卷): 2026.06 正式选考真题 (1) + 全部 2611 最新地市一模 (8) + 2610 高三强基联盟 (1)
const official2606 = catalog.papers.filter((p) => p.exam_kind === 'official');
const nov2611 = catalog.papers.filter((p) => p.collection_id === 'zj-27-shoukao' && p.exam_year === 2026 && p.exam_month === 11);
const oct2610Qiangji = catalog.papers.filter((p) => p.paper_id === 'zj-27-shoukao--gaosan-qiangji-lianmeng-2610');
const testOodPapers = [...official2606, ...nov2611, ...oct2610Qiangji];
if (testOodPapers.length !== 10) {
  throw new Error(`期望 Test-OOD 恰好 10 卷，实际命中 ${testOodPapers.length} 卷`);
}
assign(testOodPapers, 'test_ood', '时间外推与真题封存测试集（2026.06选考真题 + 2611最新一模8卷 + 2610强基联盟）');

// 2. Prod-Unanswered (11 卷): 尚未入库原卷答案且无 AI 参考答案的试卷
const unanswered = catalog.papers.filter(
  (p) => !assigned.has(p.paper_id) && p.source_answer_count === 0 && !p.paper_id.includes('paper-281c952e2dc7d42f')
);
if (unanswered.length !== 11) {
  throw new Error(`期望无答案卷恰好 11 卷，实际命中 ${unanswered.length} 卷`);
}
assign(unanswered, 'prod_unanswered', '暂无原卷答案包，留作终验通过后的纯题面受控推断扩展集');

// 辅助函数：从指定集合剩余满原卷答案试卷中按确定性哈希抽取 N 卷
function takeFromCollection(colId, count) {
  const pool = deterministicSort(
    catalog.papers.filter(
      (p) => !assigned.has(p.paper_id) && p.collection_id === colId && p.source_answer_count === p.question_count
    )
  );
  if (pool.length < count) {
    throw new Error(`集合 ${colId} 剩余可用满答卷不足: 需要 ${count}，实际 ${pool.length}`);
  }
  return pool.slice(0, count);
}

// 3. Train-Seed (12 卷): 前四个历史备考集合各抽 3 套代表卷
const trainSeed = [
  ...takeFromCollection('zj-25-shoukao', 3),
  ...takeFromCollection('zj-25-erkao', 3),
  ...takeFromCollection('zj-26-shoukao', 3),
  ...takeFromCollection('zj-26-erkao', 3)
];
assign(trainSeed, 'train_seed', '种子训练集（历史四库分层各3卷，用于校准本体 v1.1 与提取子问黄金样例）');

// 4. Test-ID (10 卷): 历史四库分层随机封存测试集 (3 + 2 + 3 + 2 = 10)
const testId = [
  ...takeFromCollection('zj-25-shoukao', 3),
  ...takeFromCollection('zj-25-erkao', 2),
  ...takeFromCollection('zj-26-shoukao', 3),
  ...takeFromCollection('zj-26-erkao', 2)
];
assign(testId, 'test_id', '同分布分层封存测试集（开发期硬锁禁止读取）');

// 5. Dev-A (10 卷): 第一折盲测验证集 (3 + 2 + 3 + 2 = 10)
const devA = [
  ...takeFromCollection('zj-25-shoukao', 3),
  ...takeFromCollection('zj-25-erkao', 2),
  ...takeFromCollection('zj-26-shoukao', 3),
  ...takeFromCollection('zj-26-erkao', 2)
];
assign(devA, 'dev_a', '第一折盲测验证集（检验 v1.1 OOV 率与双智能体边界分歧）');

// 6. Dev-B (10 卷): 第二折盲测验证集（含早期 27首考 4 卷 + 前四库 6 卷）
const devB = [
  ...takeFromCollection('zj-27-shoukao', 4),
  ...takeFromCollection('zj-25-shoukao', 2),
  ...takeFromCollection('zj-25-erkao', 1),
  ...takeFromCollection('zj-26-shoukao', 2),
  ...takeFromCollection('zj-26-erkao', 1)
];
assign(devB, 'dev_b', '第二折盲测验证集（含 27首考早期卷，验证本体 v1.2 泛化收敛）');

// 7. Prod-Backfill (72 卷): 剩余全部有完整原卷答案或已核验 AI 参考答案的试卷
const remaining = catalog.papers.filter((p) => !assigned.has(p.paper_id));
if (remaining.length !== 72) {
  throw new Error(`期望 Prod-Backfill 恰好 72 卷，实际剩余 ${remaining.length} 卷`);
}
assign(remaining, 'prod_backfill', '主体规模化回填集（Test 终验冻结本体后批量答案锚定入库）');

const splitSummary = {};
const paperEntries = catalog.papers.map((p) => {
  const { split, reason } = assigned.get(p.paper_id);
  const qs = qByPaper.get(p.paper_id) || [];
  splitSummary[split] = splitSummary[split] || { papers: 0, questions: 0 };
  splitSummary[split].papers++;
  splitSummary[split].questions += qs.length;
  return {
    paper_id: p.paper_id,
    collection_id: p.collection_id,
    title: p.title,
    exam_year: p.exam_year,
    exam_month: p.exam_month,
    exam_kind: p.exam_kind,
    question_count: p.question_count,
    source_answer_count: p.source_answer_count,
    split,
    held_out_locked: split === 'test_id' || split === 'test_ood',
    reason,
    paper_questions_sha256: sha256(qs)
  };
});

const payload = {
  schema_version: 1,
  bank_version: catalog.version,
  split_salt: SALT,
  total_papers: paperEntries.length,
  total_questions: qIndex.questions.length,
  summary: splitSummary,
  papers: paperEntries
};

const outDir = path.join(KG_ROOT, 'splits');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'dataset-splits.json'), JSON.stringify(payload, null, 2) + '\n');
console.log(JSON.stringify({ total_papers: payload.total_papers, total_questions: payload.total_questions, summary: splitSummary }, null, 2));
