import test from 'node:test';
import assert from 'node:assert/strict';
import { KG_ROOT, loadOntology } from '../src/loader.mjs';
import { validateOntology, detectCycles, validatePaperAnnotation } from '../src/validator.mjs';
import { buildKnowledgeGraph } from '../src/compiler.mjs';
import {
  loadBundle,
  locateNodes,
  inspectNodes,
  computeCurriculumScope,
  matchQuestions,
  diagnoseError
} from '../src/engine.mjs';
import { loadSplits, assertPaperReadable, HeldOutTestAccessError } from '../src/split-guard.mjs';

test('K1 本体通过完整性、五大主题兼容与严格 DAG 无环门禁', () => {
  const onto = loadOntology(KG_ROOT);
  const res = validateOntology(onto);
  assert.equal(res.ok, true, res.errors.join('\n'));
  assert.equal(res.counts.chapters, 27);
  assert.ok(res.counts.laws >= 130);
  assert.ok(res.counts.models >= 90);
  assert.ok(res.counts.experiments >= 21);
  assert.ok(res.counts.traps >= 85);
});

test('环路检测器能准确捕获注入的 REQUIRES_PREREQ 环路', () => {
  const cycles = detectCycles(
    ['a', 'b', 'c'],
    [
      { from: 'a', to: 'b', type: 'REQUIRES_PREREQ' },
      { from: 'b', to: 'c', type: 'REQUIRES_PREREQ' },
      { from: 'c', to: 'a', type: 'REQUIRES_PREREQ' }
    ],
    'REQUIRES_PREREQ'
  );
  assert.equal(cycles.length, 1);
});

test('135 卷五级切分完备互斥，且封存测试集 (test_id / test_ood) 防泄漏硬门禁生效', () => {
  const splits = loadSplits(KG_ROOT);
  assert.equal(splits.total_papers, 135);
  assert.equal(splits.total_questions, 2488);
  assert.equal(splits.summary.train_seed.papers, 12);
  assert.equal(splits.summary.dev_a.papers, 10);
  assert.equal(splits.summary.dev_b.papers, 10);
  assert.equal(splits.summary.test_id.papers, 10);
  assert.equal(splits.summary.test_ood.papers, 10);
  assert.equal(splits.summary.prod_backfill.papers, 72);
  assert.equal(splits.summary.prod_unanswered.papers, 11);

  const oodPaper = splits.papers.find((p) => p.split === 'test_ood');
  assert.ok(oodPaper);
  assert.throws(
    () => assertPaperReadable(oodPaper.paper_id, { splitsData: splits }),
    HeldOutTestAccessError
  );
  // 显式传入审计解锁开关时允许访问
  const unlocked = assertPaperReadable(oodPaper.paper_id, { splitsData: splits, unlockHeldOutTest: true });
  assert.equal(unlocked.paper_id, oodPaper.paper_id);

  // Train-Seed 默认允许访问
  const trainPaper = splits.papers.find((p) => p.split === 'train_seed');
  assert.doesNotThrow(() => assertPaperReadable(trainPaper.paper_id, { splitsData: splits }));
});

test('弹性教学顺序零超纲计算器：未学动量时自动拦截双杆模型但放行纯牛二/能量模型', () => {
  buildKnowledgeGraph(KG_ROOT);
  const bundle = loadBundle(KG_ROOT);

  // 假设高二学生学完了 必修1-3 + 选择性必修2(磁场与电磁感应)，但尚未学 选择性必修1(动量与波光)
  const scope = computeCurriculumScope(bundle, ['b1', 'b2', 'b3', 's2']);
  const unlockedModels = new Set(scope.unlocked.models);

  // 含容无阻单杆恒力拉动匀加速模型只依赖 电容 + 动生电动势 + 牛顿第二定律 -> 应已解锁！
  assert.equal(unlockedModels.has('model.ind.single_rod_capacitor_accel'), true);
  // 等间距双杆与不等间距双杆模型依赖 动量守恒/动量定理 (unit.s1.c1) -> 必须被精确拦截为超纲！
  assert.equal(unlockedModels.has('model.ind.equal_rail_dual_rod'), false);
  assert.equal(unlockedModels.has('model.ind.unequal_rail_dual_rod'), false);

  // 一旦补学 选必一第一章 (unit.s1.c1 动量守恒定律) -> 双杆模型立即解锁！
  const scopeWithMomentum = computeCurriculumScope(bundle, ['b1', 'b2', 'b3', 's2', 'unit.s1.c1']);
  assert.equal(new Set(scopeWithMomentum.unlocked.models).has('model.ind.unequal_rail_dual_rod'), true);
});

test('母模型检索自动展开子变式树，且错因诊断能返回判别探针与补救目标', () => {
  const bundle = loadBundle(KG_ROOT);
  const hits = locateNodes(bundle, { query: '磁聚焦' });
  assert.equal(hits[0].id, 'model.mag.magnetic_focusing_defocus');

  const card = inspectNodes(bundle, ['model.mag.bounded_mag_chord_tangent'])[0];
  assert.ok(card.variant_subtree.includes('model.mag.scaling_circle_critical'));
  assert.ok(card.variant_subtree.includes('model.mag.rotating_circle_envelope'));

  const diag = diagnoseError(bundle, { trapQuery: '不等间距 动量守恒' });
  assert.ok(diag.length >= 1);
  assert.equal(diag[0].trap_id, 'trap.em.unequal_rails_momentum_conserved');
  assert.ok(diag[0].remediation_targets.some((t) => t.id === 'model.ind.unequal_rail_dual_rod'));
});

test('题目标注门禁拦截野生节点 ID、指纹漂移与缺失子问推理链的非选择题', () => {
  const onto = loadOntology(KG_ROOT);
  const mockBankPaper = {
    paper_id: 'mock-paper',
    questions: [
      { id: 'q1', type: '单选题', fingerprint: 'sha_q1' },
      { id: 'q15', type: '计算题', fingerprint: 'sha_q15' }
    ]
  };

  // 非法情况：野生 ID + 计算题无 subquestions
  const badAnn = {
    paper_id: 'mock-paper',
    ontology_version: onto.meta.ontology_version,
    questions: [
      {
        question_id: 'q1',
        question_sha256: 'sha_q1',
        annotation_source: 'answer_grounded_ai',
        slot: 'slot.choice.si_concept',
        laws: ['law.fake.nonexistent']
      },
      {
        question_id: 'q15',
        question_sha256: 'wrong_sha',
        annotation_source: 'answer_grounded_ai',
        slot: 'slot.nonchoice.calc_thermo',
        models: ['model.thermo.cylinder_piston_thermo1']
      }
    ]
  };
  const badRes = validatePaperAnnotation(badAnn, onto, mockBankPaper);
  assert.equal(badRes.ok, false);
  assert.ok(badRes.errors.some((e) => e.includes('野生 ID')));
  assert.ok(badRes.errors.some((e) => e.includes('指纹漂移')));
  assert.ok(badRes.errors.some((e) => e.includes('子问级推理链')));

  // 合法情况
  const goodAnn = {
    paper_id: 'mock-paper',
    ontology_version: onto.meta.ontology_version,
    questions: [
      {
        question_id: 'q1',
        question_sha256: 'sha_q1',
        annotation_source: 'answer_grounded_ai',
        slot: 'slot.choice.si_concept',
        laws: ['law.m3.si_base_units'],
        traps: ['trap.gen.si_derived_as_base']
      },
      {
        question_id: 'q15',
        question_sha256: 'sha_q15',
        annotation_source: 'answer_grounded_ai',
        slot: 'slot.nonchoice.calc_thermo',
        models: ['model.thermo.cylinder_piston_thermo1'],
        subquestions: [
          {
            sub_id: '(1)',
            score: 4,
            process: '缓慢加热至活塞刚触卡环等压过程',
            invoked_laws: ['law.m2.concurrent_equilibrium', 'law.t2.gas_three_laws_ideal']
          }
        ]
      }
    ]
  };
  const goodRes = validatePaperAnnotation(goodAnn, onto, mockBankPaper);
  assert.equal(goodRes.ok, true, goodRes.errors.join('\n'));
  // 验证 matchQuestions 在 mock 束上的零超纲过滤
  const fakeBundle = loadBundle(KG_ROOT);
  fakeBundle.questions = {
    q1: { ...goodAnn.questions[0], paper_id: 'mock-paper', required_units: ['unit.b1.c4.s4'] },
    q15: { ...goodAnn.questions[1], paper_id: 'mock-paper', required_units: ['unit.b1.c3.s5', 'unit.s3.c2.s3'] }
  };
  const b1Only = matchQuestions(fakeBundle, { learnedSelectors: ['b1'] });
  assert.equal(b1Only.total, 1);
  assert.equal(b1Only.questions[0].question_id, 'q1');
  assert.equal(b1Only.rejected_out_of_scope, 1);
});
