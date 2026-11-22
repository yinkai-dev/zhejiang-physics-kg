import path from 'node:path';
import { KG_ROOT, readJson } from './loader.mjs';

/**
 * 加载已编译的 kg-bundle.json
 */
export function loadBundle(root = KG_ROOT) {
  return readJson(path.join(root, 'dist', 'kg-bundle.json'));
}

/**
 * 原语 1: locateNodes —— 多维语义/别名/题面触发词混合定位图谱节点
 * @param {object} bundle kg-bundle 对象
 * @param {{query: string, types?: string[], topic?: string, limit?: number}} params
 */
export function locateNodes(bundle, { query, types, topic, limit = 15 }) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const typeSet = types?.length ? new Set(types) : null;
  const results = [];

  for (const node of Object.values(bundle.nodes)) {
    if (typeSet && !typeSet.has(node.type)) continue;
    if (topic && !(node.topics || []).includes(topic)) continue;

    const hayTitle = `${node.id} ${node.title}`.toLowerCase();
    const hayAliases = (node.aliases || []).join(' ').toLowerCase();
    const hayClues = (node.surface_clues || []).join(' ').toLowerCase();
    const hayExtra = [
      node.module || '',
      node.family || '',
      node.domain || '',
      node.category || '',
      ...(node.conditions || []),
      node.rule || '',
      node.probe || ''
    ].join(' ').toLowerCase();

    let score = 0;
    for (const term of terms) {
      let matched = false;
      if (node.id.toLowerCase() === term || node.title.toLowerCase() === term) {
        score += 100;
        matched = true;
      } else if (hayTitle.includes(term)) {
        score += 40;
        matched = true;
      }
      if (hayAliases.includes(term)) {
        score += 35;
        matched = true;
      }
      if (hayClues.includes(term)) {
        score += 25;
        matched = true;
      }
      if (hayExtra.includes(term)) {
        score += 10;
        matched = true;
      }
      if (!matched) {
        score = -1;
        break;
      }
    }
    if (score > 0) {
      results.push({
        id: node.id,
        type: node.type,
        title: node.title,
        topics: node.topics,
        group: node.module || node.family || node.domain || node.category || node.book_title || '',
        question_count: node.question_count || 0,
        score
      });
    }
  }

  return results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

/**
 * 原语 2: inspectNodes —— 获取目标节点的 L1 完整物理推理契约卡与 1 跳邻域
 * @param {object} bundle
 * @param {string[]} nodeIds
 */
export function inspectNodes(bundle, nodeIds) {
  return nodeIds.map((id) => {
    const node = bundle.nodes[id];
    if (!node) return { id, error: 'not_found' };
    const outEdges = bundle.edges.filter((e) => e.from === id);
    const inEdges = bundle.edges.filter((e) => e.to === id);
    return {
      ...node,
      neighbors: {
        outgoing: outEdges.map((e) => ({
          type: e.type,
          target: e.to,
          target_title: bundle.nodes[e.to]?.title,
          ...(e.distinction ? { distinction: e.distinction } : {})
        })),
        incoming_count: inEdges.length,
        triggered_by_models: inEdges
          .filter((e) => e.type === 'APPLIES_LAW' || e.type === 'TRIGGERS_TRAP')
          .map((e) => ({ id: e.from, title: bundle.nodes[e.from]?.title }))
      }
    };
  });
}

/**
 * 将用户传入的册别缩写（如 "b1", "b2"）、章 ID（"unit.s1.c1"）或节 ID（"unit.s1.c1.s2"）展开为标准节 ID 集合
 * @param {object} bundle
 * @param {string[]} selectors
 */
export function expandUnitSelectors(bundle, selectors) {
  const learnedSections = new Set();
  const allSections = Object.values(bundle.nodes).filter(
    (n) => n.type === 'CurriculumUnit' && n.level === 'section'
  );

  for (const raw of selectors || []) {
    const sel = raw.trim();
    if (/^(b[1-3]|s[1-3])$/.test(sel)) {
      for (const sec of allSections) {
        if (sec.book_id === sel) learnedSections.add(sec.id);
      }
    } else if (bundle.nodes[sel]?.type === 'CurriculumUnit') {
      const u = bundle.nodes[sel];
      if (u.level === 'chapter') {
        for (const sid of u.section_ids || []) learnedSections.add(sid);
      } else {
        learnedSections.add(u.id);
      }
    } else {
      throw new Error(`无法识别的教材进度选择器: "${sel}"（可用示例: b1, b2, unit.s1.c1, unit.b3.c10.s4）`);
    }
  }
  return learnedSections;
}

/**
 * 原语 3: computeCurriculumScope —— 浙江弹性选修顺序下的“零超纲”范围计算器
 * @param {object} bundle
 * @param {string[]} learnedSelectors 已学教材选择器数组
 */
export function computeCurriculumScope(bundle, learnedSelectors) {
  const learnedSections = expandUnitSelectors(bundle, learnedSelectors);
  const unlockedLaws = [];
  const blockedLaws = [];
  const unlockedModels = [];
  const blockedModels = [];
  const unlockedExperiments = [];
  const blockedExperiments = [];

  const isUnlocked = (node) => {
    const req = node.required_units || [];
    return req.every((u) => learnedSections.has(u));
  };

  for (const node of Object.values(bundle.nodes)) {
    if (node.type === 'ConceptAndLaw') {
      (isUnlocked(node) ? unlockedLaws : blockedLaws).push(node.id);
    } else if (node.type === 'PhysicalModel') {
      (isUnlocked(node) ? unlockedModels : blockedModels).push(node.id);
    } else if (node.type === 'Experiment') {
      (isUnlocked(node) ? unlockedExperiments : blockedExperiments).push(node.id);
    }
  }

  return {
    learned_section_count: learnedSections.size,
    learned_sections: [...learnedSections].sort(),
    unlocked: {
      laws: unlockedLaws.sort(),
      models: unlockedModels.sort(),
      experiments: unlockedExperiments.sort()
    },
    blocked_counts: {
      laws: blockedLaws.length,
      models: blockedModels.length,
      experiments: blockedExperiments.length
    },
    blocked_sample: {
      laws: blockedLaws.slice(0, 10),
      models: blockedModels.slice(0, 10)
    }
  };
}

/**
 * 判断单个节点是否在题目（及其子变式/隐式规律）上命中
 */
function questionMatchesNode(bundle, qAnn, targetNodeId) {
  const targetNode = bundle.nodes[targetNodeId];
  if (!targetNode) return false;

  // 若目标是母模型，自动展开子变式树匹配
  const acceptIds = new Set(targetNode.variant_subtree || [targetNodeId]);

  // 若目标是教材章，展开为其下属节
  if (targetNode.type === 'CurriculumUnit') {
    const secSet = targetNode.level === 'chapter' ? new Set(targetNode.section_ids) : new Set([targetNodeId]);
    return (qAnn.required_units || []).some((u) => secSet.has(u));
  }

  const qAllNodes = new Set([
    ...(qAnn.models || []),
    ...(qAnn.laws || []),
    ...(qAnn.experiments || []),
    ...(qAnn.exp_skills || []),
    ...(qAnn.methods || []),
    ...(qAnn.traps || []),
    ...(qAnn.slot ? [qAnn.slot] : []),
    ...(qAnn.subquestions || []).flatMap((s) => [...(s.invoked_laws || []), ...(s.exp_skills || [])])
  ]);
  // 补充模型隐含调用的底层规律
  for (const mid of qAnn.models || []) {
    for (const lid of bundle.nodes[mid]?.prereq_laws || []) qAllNodes.add(lid);
  }

  for (const id of acceptIds) {
    if (qAllNodes.has(id)) return true;
  }
  return false;
}

/**
 * 原语 4: matchQuestions —— 图谱拓扑级确定性选题与“零超纲”硬过滤
 * @param {object} bundle
 * @param {{
 *   mustNodes?: string[],
 *   anyNodes?: string[],
 *   excludeNodes?: string[],
 *   learnedSelectors?: string[],
 *   slot?: string,
 *   paperId?: string,
 *   limit?: number
 * }} filters
 */
export function matchQuestions(bundle, filters = {}) {
  const {
    mustNodes = [],
    anyNodes = [],
    excludeNodes = [],
    learnedSelectors = null,
    slot = null,
    paperId = null,
    limit = 50
  } = filters;

  const learnedSections = learnedSelectors ? expandUnitSelectors(bundle, learnedSelectors) : null;
  const matched = [];
  let rejectedByOutOfScope = 0;

  for (const qAnn of Object.values(bundle.questions || {})) {
    if (paperId && qAnn.paper_id !== paperId) continue;
    if (slot && qAnn.slot !== slot) continue;

    if (mustNodes.length > 0 && !mustNodes.every((nid) => questionMatchesNode(bundle, qAnn, nid))) {
      continue;
    }
    if (anyNodes.length > 0 && !anyNodes.some((nid) => questionMatchesNode(bundle, qAnn, nid))) {
      continue;
    }
    if (excludeNodes.length > 0 && excludeNodes.some((nid) => questionMatchesNode(bundle, qAnn, nid))) {
      continue;
    }

    // 零超纲硬过滤：题目所需的每一个教材节次都必须在已学集合内
    if (learnedSections) {
      const reqUnits = qAnn.required_units || [];
      if (reqUnits.length === 0 || !reqUnits.every((u) => learnedSections.has(u))) {
        rejectedByOutOfScope++;
        continue;
      }
    }

    matched.push(qAnn);
  }

  matched.sort((a, b) => a.question_id.localeCompare(b.question_id));
  return {
    total: matched.length,
    rejected_out_of_scope: rejectedByOutOfScope,
    questions: matched.slice(0, limit)
  };
}

/**
 * 原语 5: diagnoseError —— 基于题目或迷思关键词定位错因探针与回退补救路径
 * @param {object} bundle
 * @param {{questionId?: string, trapQuery?: string}} params
 */
export function diagnoseError(bundle, { questionId, trapQuery }) {
  const candidateTraps = [];
  if (questionId && bundle.questions[questionId]) {
    const qAnn = bundle.questions[questionId];
    const trapIds = new Set(qAnn.traps || []);
    for (const mid of qAnn.models || []) {
      for (const e of bundle.edges) {
        if (e.from === mid && e.type === 'TRIGGERS_TRAP') trapIds.add(e.to);
      }
    }
    for (const tid of trapIds) {
      if (bundle.nodes[tid]) candidateTraps.push(bundle.nodes[tid]);
    }
  }
  if (trapQuery) {
    const hits = locateNodes(bundle, { query: trapQuery, types: ['Misconception'], limit: 5 });
    for (const h of hits) {
      if (!candidateTraps.some((t) => t.id === h.id)) candidateTraps.push(bundle.nodes[h.id]);
    }
  }

  return candidateTraps.map((trap) => {
    const remediationNodes = (trap.remediated_by || []).map((rid) => {
      const rn = bundle.nodes[rid];
      const remediationQuestions = (bundle.node_questions[rid] || []).filter((qid) => qid !== questionId).slice(0, 5);
      const tbIds = bundle.node_textbook_items?.[rid] || [];
      const tbCards = tbIds
        .map((tid) => bundle.textbook_items?.[tid])
        .filter(Boolean)
        .sort((a, b) => {
          const rank = (x) => (x.category === 'worked_example' ? 0 : x.pedagogical_role === 'canonical_archetype' ? 1 : 2);
          return rank(a) - rank(b) || (a.printed_page || 0) - (b.printed_page || 0);
        })
        .slice(0, 3)
        .map((x) => ({
          item_id: x.item_id,
          book_id: x.book_id,
          printed_page: x.printed_page,
          category: x.category,
          concise_topic: x.concise_topic
        }));
      return {
        id: rid,
        type: rn?.type,
        title: rn?.title,
        sample_textbook_archetypes: tbCards,
        sample_question_ids: remediationQuestions
      };
    });
    return {
      trap_id: trap.id,
      title: trap.title,
      diagnostic_probe: trap.probe,
      remediation_targets: remediationNodes
    };
  });
}

/**
 * 原语 6: buildBlueprint —— 生成浙江 18 题仿真双向细目表或专题梯度训练蓝图
 * @param {object} bundle
 * @param {{mode?: 'zhejiang_18_mock'|'topic_drill', focusNodeIds?: string[], learnedSelectors?: string[]}} params
 */
export function buildBlueprint(bundle, { mode = 'zhejiang_18_mock', focusNodeIds = [], learnedSelectors = null } = {}) {
  if (mode === 'topic_drill') {
    const res = matchQuestions(bundle, { anyNodes: focusNodeIds, learnedSelectors, limit: 20 });
    return {
      mode,
      focus_nodes: focusNodeIds,
      total_candidates: res.total,
      selected_questions: res.questions.slice(0, 12).map((q) => ({
        question_id: q.question_id,
        slot: q.slot,
        models: q.models,
        laws: q.laws
      }))
    };
  }

  // 浙江 18 题标准卷结构槽位配额
  const structure = [
    { slot: 'slot.choice.si_concept', count: 1 },
    { slot: 'slot.choice.mech_core', count: 4 },
    { slot: 'slot.choice.em_core', count: 3 },
    { slot: 'slot.choice.single_capstone', count: 2 },
    { slot: 'slot.choice.multi_mod_thermo', count: 1 },
    { slot: 'slot.choice.multi_wave_opt', count: 1 },
    { slot: 'slot.choice.multi_capstone', count: 1 },
    { slot: 'slot.nonchoice.exp_trio', count: 1 },
    { slot: 'slot.nonchoice.calc_thermo', count: 1 },
    { slot: 'slot.nonchoice.calc_mech', count: 1 },
    { slot: 'slot.nonchoice.calc_ind', count: 1 },
    { slot: 'slot.nonchoice.calc_particle', count: 1 }
  ];

  const usedModels = new Set();
  const usedPapers = new Set();
  const items = [];

  for (const s of structure) {
    const pool = matchQuestions(bundle, { slot: s.slot, learnedSelectors, limit: 200 }).questions;
    const chosen = [];
    for (const q of pool) {
      if (chosen.length >= s.count) break;
      const modelCollision = (q.models || []).some((m) => usedModels.has(m));
      if (modelCollision && pool.length > s.count * 2) continue;
      chosen.push(q);
      usedPapers.add(q.paper_id);
      for (const m of q.models || []) usedModels.add(m);
    }
    items.push({
      slot: s.slot,
      slot_title: bundle.nodes[s.slot]?.title,
      requested: s.count,
      filled: chosen.length,
      questions: chosen.map((q) => ({
        question_id: q.question_id,
        paper_id: q.paper_id,
        models: q.models,
        laws: q.laws
      }))
    });
  }

  return {
    mode: 'zhejiang_18_mock',
    total_requested: 18,
    total_filled: items.reduce((acc, x) => acc + x.filled, 0),
    distinct_source_papers: usedPapers.size,
    distinct_models_covered: usedModels.size,
    slots: items
  };
}

/**
 * 原语 7: queryArchetypes —— 检索人教版 6 册教材母题、STSE/拓展/漫步栏目与必做实验原型
 */
export function queryArchetypes(
  bundle,
  {
    query = '',
    nodeIds = [],
    bookId = null,
    category = null,
    role = null,
    gaokaoOnly = false,
    learnedSelectors = null,
    limit = 25
  } = {}
) {
  const learnedSections = learnedSelectors ? expandUnitSelectors(bundle, learnedSelectors) : null;
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  // 展开节点过滤（母模型展开子变式树，章展开节）
  const expandedFilterSets = nodeIds.map((nid) => {
    const n = bundle.nodes[nid];
    if (!n) return new Set([nid]);
    if (n.variant_subtree) return new Set(n.variant_subtree);
    if (n.type === 'CurriculumUnit' && n.level === 'chapter') return new Set([nid, ...(n.section_ids || [])]);
    return new Set([nid]);
  });

  const matched = [];
  for (const item of Object.values(bundle.textbook_items || {})) {
    if (bookId && item.book_id !== bookId) continue;
    if (category && item.category !== category) continue;
    if (role && item.pedagogical_role !== role) continue;
    if (gaokaoOnly && !(item.derived_gaokao_questions?.length > 0)) continue;

    if (learnedSections) {
      const req = item.required_units || [];
      if (req.length === 0 || !req.every((u) => learnedSections.has(u))) continue;
    }

    if (expandedFilterSets.length > 0) {
      const itemNodes = new Set([
        item.unit_id,
        ...(item.models || []),
        ...(item.laws || []),
        ...(item.experiments || []),
        ...(item.exp_skills || []),
        ...(item.methods || []),
        ...(item.traps || [])
      ]);
      if (!expandedFilterSets.every((fset) => [...fset].some((x) => itemNodes.has(x)))) continue;
    }

    if (terms.length > 0) {
      const nodeTitles = [
        ...(item.models || []),
        ...(item.laws || []),
        ...(item.experiments || [])
      ]
        .map((id) => bundle.nodes[id]?.title || '')
        .join(' ');
      const hay = `${item.item_id} ${item.concise_topic} ${item.category} ${nodeTitles}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) continue;
    }

    matched.push(item);
  }

  matched.sort(
    (a, b) =>
      (b.derived_gaokao_questions?.length || 0) - (a.derived_gaokao_questions?.length || 0) ||
      a.item_id.localeCompare(b.item_id)
  );

  return {
    total: matched.length,
    items: matched.slice(0, limit).map((x) => ({
      item_id: x.item_id,
      book_id: x.book_id,
      unit_id: x.unit_id,
      unit_title: bundle.nodes[x.unit_id]?.title,
      printed_page: x.printed_page,
      category: x.category,
      pedagogical_role: x.pedagogical_role,
      concise_topic: x.concise_topic,
      models: x.models,
      laws: x.laws,
      experiments: x.experiments,
      derived_gaokao_count: x.derived_gaokao_questions?.length || 0,
      derived_gaokao_questions: x.derived_gaokao_questions || []
    }))
  };
}

/**
 * 原语 8: traceProvenance —— 双向溯源：从高考真题/模拟题查课本第一出处，或从课本条目反查历年真题与联考变式
 */
export function traceProvenance(
  bundle,
  { questionId = null, paperId = null, level = null, textbookId = null, query = '', limit = 30 } = {}
) {
  const expandTb = (tid) => {
    const tb = bundle.textbook_items?.[tid];
    if (!tb) return { item_id: tid };
    return {
      item_id: tb.item_id,
      book_id: tb.book_id,
      unit_id: tb.unit_id,
      unit_title: bundle.nodes[tb.unit_id]?.title,
      printed_page: tb.printed_page,
      category: tb.category,
      pedagogical_role: tb.pedagogical_role,
      concise_topic: tb.concise_topic
    };
  };

  // 1. 若按具体教材条目 ID 反查衍生出的高考真题与同源模拟题
  if (textbookId) {
    const tb = bundle.textbook_items?.[textbookId];
    if (!tb) return { error: 'textbook_item_not_found', textbookId };
    const mockMatches = Object.values(bundle.questions || {})
      .filter((q) => (q.recommended_textbook_ids || []).includes(textbookId))
      .map((q) => ({ question_id: q.question_id, paper_id: q.paper_id, slot: q.slot, models: q.models }))
      .slice(0, limit);
    return {
      mode: 'textbook_to_exams',
      archetype: expandTb(textbookId),
      derived_gaokao_questions: tb.derived_gaokao_questions || [],
      matched_bank_questions_count: mockMatches.length,
      matched_bank_questions: mockMatches
    };
  }

  // 2. 若按单个题号查询（先查官方高考真题溯源库，再查题库模拟题推荐原型）
  if (questionId) {
    for (const p of bundle.gaokao_provenance || []) {
      const hit = (p.questions || []).find((q) => q.question_id === questionId);
      if (hit) {
        return {
          mode: 'gaokao_question_provenance',
          paper_id: p.paper_id,
          paper_title: p.title,
          ...hit,
          source_textbook_cards: (hit.source_textbook_ids || []).map(expandTb)
        };
      }
    }
    const bankQ = bundle.questions?.[questionId];
    if (bankQ) {
      return {
        mode: 'bank_question_archetype_match',
        question_id: bankQ.question_id,
        paper_id: bankQ.paper_id,
        slot: bankQ.slot,
        models: bankQ.models,
        laws: bankQ.laws,
        recommended_textbook_cards: (bankQ.recommended_textbook_ids || []).map(expandTb)
      };
    }
    return { error: 'question_not_found', questionId };
  }

  // 3. 批量筛选历年浙江选考官方真题溯源库
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];
  for (const p of bundle.gaokao_provenance || []) {
    if (paperId && p.paper_id !== paperId) continue;
    for (const q of p.questions || []) {
      if (level && q.provenance_level !== level) continue;
      if (terms.length > 0) {
        const tbText = (q.source_textbook_ids || []).map((tid) => bundle.textbook_items?.[tid]?.concise_topic || '').join(' ');
        const hay = `${p.title} ${q.question_id} ${q.exam_question_summary} ${q.adaptation_mechanism} ${tbText}`.toLowerCase();
        if (!terms.every((t) => hay.includes(t))) continue;
      }
      results.push({
        paper_id: p.paper_id,
        paper_title: p.title,
        question_no: q.question_no,
        question_id: q.question_id,
        exam_question_summary: q.exam_question_summary,
        provenance_level: q.provenance_level,
        source_textbook_cards: (q.source_textbook_ids || []).map(expandTb),
        adaptation_mechanism: q.adaptation_mechanism
      });
    }
  }

  return {
    mode: 'gaokao_provenance_search',
    total: results.length,
    results: results.slice(0, limit)
  };
}
