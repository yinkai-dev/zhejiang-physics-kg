import { expandUnitSelectors } from './engine.mjs';

/**
 * 计算两个集合的 Jaccard 相似度與主集合覆盖率
 * @param {Iterable<string>} setA
 * @param {Iterable<string>} setB
 */
export function setOverlapMetrics(setA, setB) {
  const a = new Set(setA);
  const b = new Set(setB);
  if (a.size === 0 && b.size === 0) return { jaccard: 1, recall_on_b: 1, precision_on_b: 1 };
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return {
    jaccard: union > 0 ? inter / union : 0,
    recall_on_b: b.size > 0 ? inter / b.size : 1,
    precision_on_b: a.size > 0 ? inter / a.size : 1
  };
}

/**
 * 指标 1: 本体未覆盖溢出率 (OOV / Proposal Rate)
 * 统计盲测试卷中触发 oov_proposals 的题目占比
 */
export function evaluateOovRate(paperAnnotations) {
  let totalQuestions = 0;
  let oovQuestions = 0;
  const proposals = [];

  for (const p of paperAnnotations) {
    for (const q of p.questions || []) {
      totalQuestions++;
      if (Array.isArray(q.oov_proposals) && q.oov_proposals.length > 0) {
        oovQuestions++;
        for (const prop of q.oov_proposals) {
          proposals.push({ question_id: q.question_id, ...prop });
        }
      }
    }
  }
  return {
    total_questions: totalQuestions,
    oov_questions: oovQuestions,
    oov_rate: totalQuestions > 0 ? Number((oovQuestions / totalQuestions).toFixed(4)) : 0,
    proposals
  };
}

/**
 * 提取单题的核心挂载集合（模型 + 规律 + 实验）用于一致性或召回率比对
 * 若传入 bundle，自动把模型隐含调用的底层规律合并到 laws 维度以避免“标了模型漏重标底层规律”的假性不一致
 */
function extractComparableSets(q, bundle = null) {
  const modelsAndExps = new Set([...(q.models || []), ...(q.experiments || [])]);
  const allLaws = new Set([
    ...(q.laws || []),
    ...(q.subquestions || []).flatMap((s) => s.invoked_laws || [])
  ]);
  if (bundle) {
    for (const mid of q.models || []) {
      for (const lid of bundle.nodes[mid]?.applies_law || []) allLaws.add(lid);
    }
  }
  return {
    slot: q.slot,
    models_and_exps: modelsAndExps,
    effective_laws: allLaws,
    core_union: new Set([...modelsAndExps, ...allLaws])
  };
}

/**
 * 指标 2 & 3: 双智能体独立盲标一致率 / 纯题面预测 vs 答案锚定真值召回率
 * @param {object[]} runAPapers 预测侧或智能体 A 标注列表
 * @param {object[]} runBPapers 基准真值侧（如答案锚定标注）或智能体 B 标注列表
 * @param {object|null} bundle 已编译图谱
 */
export function evaluateAnnotationComparison(runAPapers, runBPapers, bundle = null) {
  const mapB = new Map();
  for (const p of runBPapers) {
    for (const q of p.questions || []) mapB.set(q.question_id, q);
  }

  let compared = 0;
  let slotExact = 0;
  let sumCoreJaccard = 0;
  let sumLawRecall = 0;
  let sumModelRecall = 0;
  const disagreementPairs = new Map();

  for (const p of runAPapers) {
    for (const qA of p.questions || []) {
      const qB = mapB.get(qA.question_id);
      if (!qB) continue;
      compared++;
      const sA = extractComparableSets(qA, bundle);
      const sB = extractComparableSets(qB, bundle);

      if (sA.slot === sB.slot) slotExact++;
      const coreM = setOverlapMetrics(sA.core_union, sB.core_union);
      const lawM = setOverlapMetrics(sA.effective_laws, sB.effective_laws);
      const modM = setOverlapMetrics(sA.models_and_exps, sB.models_and_exps);

      sumCoreJaccard += coreM.jaccard;
      sumLawRecall += lawM.recall_on_b;
      sumModelRecall += modM.recall_on_b;

      // 记录分歧节点便于定位模糊词表边界
      for (const id of sA.models_and_exps) {
        if (!sB.models_and_exps.has(id)) {
          disagreementPairs.set(id, (disagreementPairs.get(id) || 0) + 1);
        }
      }
      for (const id of sB.models_and_exps) {
        if (!sA.models_and_exps.has(id)) {
          disagreementPairs.set(id, (disagreementPairs.get(id) || 0) + 1);
        }
      }
    }
  }

  return {
    compared_questions: compared,
    slot_exact_agreement: compared > 0 ? Number((slotExact / compared).toFixed(4)) : 0,
    mean_core_jaccard: compared > 0 ? Number((sumCoreJaccard / compared).toFixed(4)) : 0,
    mean_law_recall_against_ref: compared > 0 ? Number((sumLawRecall / compared).toFixed(4)) : 0,
    mean_model_recall_against_ref: compared > 0 ? Number((sumModelRecall / compared).toFixed(4)) : 0,
    top_divergent_models: [...disagreementPairs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => ({ id, title: bundle?.nodes[id]?.title || id, count }))
  };
}

/**
 * 指标 4: 零超纲筛选安全性审计
 * 用物理先验反事实信号核验：在限定教学截面下被放行的题目中，其标准答案/题面是否出现了未学册别的标志性物理符号与专有名词
 */
export function auditZeroOutOfScopeSafety(bundle, bankQuestionsMap, checkpoints = null) {
  const defaultCheckpoints = checkpoints || [
    {
      name: '高一上期末（仅学完必修第一册：直线运动+相互作用+牛顿定律）',
      selectors: ['b1'],
      forbidden_regex: /电场|电势|电容|磁感应强度|洛伦兹|安培力|感应电动势|变压器|折射率|全反射|干涉|光电效应|半衰期|理想气体|热力学第一定律|动量守恒|机械波/
    },
    {
      name: '高一下期末（学完必修一 + 必修二：纯力学不含动量与机械波及电磁热光近）',
      selectors: ['b1', 'b2'],
      forbidden_regex: /电场|电势|电容|磁感应强度|洛伦兹|安培力|感应电动势|变压器|折射率|全反射|光电效应|半衰期|理想气体|气缸/
    },
    {
      name: '高二电磁先修截面（必修一二三 + 选必二磁场电磁感应，尚未学选必一动量/波/光与选必三热/近）',
      selectors: ['b1', 'b2', 'b3', 's2'],
      forbidden_regex: /折射率|全反射|双缝干涉|光电效应|逸出功|玻尔|能级跃迁|半衰期|油膜法|理想气体|气缸/
    }
  ];

  const report = [];
  for (const cp of defaultCheckpoints) {
    const learned = expandUnitSelectors(bundle, cp.selectors);
    let passedCount = 0;
    const suspectLeaks = [];

    for (const qAnn of Object.values(bundle.questions || {})) {
      const req = qAnn.required_units || [];
      if (req.length > 0 && req.every((u) => learned.has(u))) {
        passedCount++;
        const rawQ = bankQuestionsMap.get(qAnn.question_id);
        if (rawQ && cp.forbidden_regex.test(rawQ.text)) {
          suspectLeaks.push({
            question_id: qAnn.question_id,
            matched_term: rawQ.text.match(cp.forbidden_regex)?.[0],
            models: qAnn.models,
            laws: qAnn.laws
          });
        }
      }
    }
    report.push({
      checkpoint: cp.name,
      passed_questions: passedCount,
      suspect_leak_count: suspectLeaks.length,
      leak_rate: passedCount > 0 ? Number((suspectLeaks.length / passedCount).toFixed(4)) : 0,
      suspect_leaks: suspectLeaks.slice(0, 10)
    });
  }
  return report;
}
