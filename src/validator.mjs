const ID_PATTERNS = {
  CurriculumUnit: /^unit\.(b[1-3]|s[1-3])\.c\d{1,2}(\.s\d{1,2})?$/,
  ConceptAndLaw: /^law\.(m[1-8]|e[1-5]|t[1-2]|o[1-2]|q[1-2])\.[a-z0-9_]+$/,
  PhysicalModel: /^model\.(mech|elec|mag|ind|thermo|wave|opt|mod)\.[a-z0-9_]+$/,
  Experiment: /^exp\.(mech|elec|opt|thermo)\.[a-z0-9_]+$/,
  ExpSkill: /^expskill\.(read|op|circuit|data|graph)\.[a-z0-9_]+$/,
  MethodAndTool: /^method\.(thought|graph|math)\.[a-z0-9_]+$/,
  Misconception: /^trap\.(gen|mech|em|tom|exp)\.[a-z0-9_]+$/,
  ExamSlot: /^slot\.(choice|nonchoice)\.[a-z0-9_]+$/
};

/**
 * 检测特定有向边类型是否存在有向环路（DFS 三色标记法）
 * @param {Iterable<string>} nodeIds 节点 ID 集合
 * @param {Array<{from:string,to:string,type:string}>} edges 边列表
 * @param {string} edgeType 待检查的边类型
 */
export function detectCycles(nodeIds, edges, edgeType) {
  const adj = new Map();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (e.type === edgeType && adj.has(e.from)) {
      adj.get(e.from).push(e.to);
    }
  }
  const color = new Map(); // 0=unvisited, 1=visiting, 2=done
  const parent = new Map();
  const cycles = [];

  function dfs(u) {
    color.set(u, 1);
    for (const v of adj.get(u) || []) {
      const c = color.get(v) || 0;
      if (c === 1) {
        const cycle = [v, u];
        let cur = u;
        while (cur !== v && parent.has(cur)) {
          cur = parent.get(cur);
          cycle.push(cur);
        }
        cycles.push(cycle.reverse());
      } else if (c === 0) {
        parent.set(v, u);
        dfs(v);
      }
    }
    color.set(u, 2);
  }

  for (const id of nodeIds) {
    if (!color.get(id)) dfs(id);
  }
  return cycles;
}

/**
 * 校验本体完整性、ID 规范、边引用合法性与 DAG 无环约束
 * @param {ReturnType<import('./loader.mjs').loadOntology>} ontology 已加载的本体对象
 */
export function validateOntology(ontology) {
  const errors = [];
  const { meta, unitsRaw, laws, models, experiments, expSkills, methods, traps, slots, nodes, edges } = ontology;
  const allowedTopics = new Set(meta.legacy_topics);
  const allowedNodeTypes = new Set(meta.node_types);
  const allowedEdgeTypes = new Set(meta.edge_types);

  const rawLists = [
    ...unitsRaw,
    ...unitsRaw.flatMap((u) => u.sections || []),
    ...laws,
    ...models,
    ...experiments,
    ...expSkills,
    ...methods,
    ...traps,
    ...slots
  ];

  // 1. 重复 ID 检查
  const seenIds = new Set();
  for (const item of rawLists) {
    if (seenIds.has(item.id)) {
      errors.push(`重复节点 ID: ${item.id}`);
    }
    seenIds.add(item.id);
  }

  // 2. 节点字段与五大主题兼容性检查
  for (const [id, node] of nodes.entries()) {
    if (!allowedNodeTypes.has(node.type)) {
      errors.push(`未知节点类型 ${node.type} (${id})`);
      continue;
    }
    const pattern = ID_PATTERNS[node.type];
    if (pattern && !pattern.test(id)) {
      errors.push(`节点 ID 格式不符合 ${node.type} 命名规范: ${id}`);
    }
    if (!node.title || typeof node.title !== 'string') {
      errors.push(`节点缺少有效中文标题: ${id}`);
    }
    if (!Array.isArray(node.topics) || node.topics.length === 0) {
      errors.push(`节点缺少五大主题映射: ${id}`);
    } else {
      for (const t of node.topics) {
        if (!allowedTopics.has(t)) errors.push(`节点 ${id} 含有非法主题: ${t}`);
      }
    }
    if (node.type === 'ConceptAndLaw') {
      if (!node.unit || !nodes.has(node.unit) || nodes.get(node.unit).level !== 'section') {
        errors.push(`概念规律 ${id} 未锚定到合法教材节次: ${node.unit}`);
      }
      if (!Array.isArray(node.conditions) || node.conditions.length === 0) {
        errors.push(`概念规律 ${id} 缺少适用条件护栏 (conditions)`);
      }
    }
    if (node.type === 'PhysicalModel') {
      if (!Array.isArray(node.applies_law) || node.applies_law.length === 0) {
        errors.push(`物理模型 ${id} 缺少底层调用规律 (applies_law)`);
      }
      if (!Array.isArray(node.appears_in_slot) || node.appears_in_slot.length === 0) {
        errors.push(`物理模型 ${id} 缺少浙江题位映射 (appears_in_slot)`);
      }
    }
    if (node.type === 'Misconception') {
      if (!Array.isArray(node.remediated_by) || node.remediated_by.length === 0) {
        errors.push(`认知迷思 ${id} 缺少回退补救节点 (remediated_by)`);
      }
      if (!node.probe || typeof node.probe !== 'string') {
        errors.push(`认知迷思 ${id} 缺少判别追问探针 (probe)`);
      }
    }
  }

  // 3. 边悬空与类型检查
  for (const e of edges) {
    if (!allowedEdgeTypes.has(e.type)) {
      errors.push(`未知边类型: ${e.type} (${e.from} -> ${e.to})`);
    }
    if (!nodes.has(e.from)) {
      errors.push(`有向边起点不存在: ${e.from} --[${e.type}]--> ${e.to}`);
    }
    if (!nodes.has(e.to)) {
      errors.push(`有向边终点不存在: ${e.from} --[${e.type}]--> ${e.to}`);
    }
    if (e.from === e.to) {
      errors.push(`禁止自环边: ${e.from} --[${e.type}]--> ${e.to}`);
    }
  }

  // 4. DAG 严格无环检测
  for (const dagEdgeType of ['REQUIRES_PREREQ', 'HAS_VARIANT']) {
    const cycles = detectCycles(nodes.keys(), edges, dagEdgeType);
    for (const c of cycles) {
      errors.push(`${dagEdgeType} 存在有向环路: ${c.join(' -> ')}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    counts: {
      total_nodes: nodes.size,
      chapters: unitsRaw.length,
      sections: unitsRaw.reduce((s, u) => s + (u.sections?.length || 0), 0),
      laws: laws.length,
      models: models.length,
      experiments: experiments.length,
      exp_skills: expSkills.length,
      methods: methods.length,
      traps: traps.length,
      slots: slots.length,
      edges: edges.length
    }
  };
}

/**
 * 校验单套试卷的图谱挂载标注文件（受控词表门禁 + 指纹绑定 + 非选子问完整性）
 * @param {object} paperAnnotation 单卷标注对象
 * @param {ReturnType<import('./loader.mjs').loadOntology>} ontology 本体对象
 * @param {object|null} bankPaper 题库原卷公开详情 JSON（可选，传入时严格核对每题指纹与题数）
 */
export function validatePaperAnnotation(paperAnnotation, ontology, bankPaper = null) {
  const errors = [];
  const { nodes, meta } = ontology;
  const allowedSources = new Set(meta.annotation_sources);

  if (!paperAnnotation || typeof paperAnnotation !== 'object') {
    return { ok: false, errors: ['标注内容不是有效 JSON 对象'] };
  }
  if (!paperAnnotation.paper_id) errors.push('缺少 paper_id');
  if (!paperAnnotation.ontology_version) errors.push('缺少 ontology_version');
  if (!Array.isArray(paperAnnotation.questions) || paperAnnotation.questions.length === 0) {
    errors.push(`试卷 ${paperAnnotation.paper_id} questions 数组为空`);
    return { ok: false, errors };
  }

  const bankQMap = bankPaper
    ? new Map(bankPaper.questions.map((q) => [q.id, q]))
    : null;

  if (bankQMap && paperAnnotation.questions.length !== bankQMap.size) {
    errors.push(`试卷 ${paperAnnotation.paper_id} 标注题数 (${paperAnnotation.questions.length}) 与题库实际题数 (${bankQMap.size}) 不一致`);
  }

  const checkIds = (qid, field, list, expectedTypes) => {
    if (!Array.isArray(list)) {
      errors.push(`${qid}.${field} 必须为数组`);
      return;
    }
    for (const id of list) {
      const n = nodes.get(id);
      if (!n) {
        errors.push(`${qid}.${field} 引用了未在受控词表中注册的野生 ID: ${id}（若确属新模型/考点，请放入 oov_proposals）`);
      } else if (expectedTypes && !expectedTypes.includes(n.type)) {
        errors.push(`${qid}.${field} 节点类型不匹配: ${id} 实际为 ${n.type}，期望 ${expectedTypes.join('/')}`);
      }
    }
  };

  const seenQ = new Set();
  for (const q of paperAnnotation.questions) {
    const qid = q.question_id;
    if (!qid) {
      errors.push('存在缺少 question_id 的题目标注项');
      continue;
    }
    if (seenQ.has(qid)) errors.push(`重复标注题目: ${qid}`);
    seenQ.add(qid);

    if (!allowedSources.has(q.annotation_source)) {
      errors.push(`${qid} annotation_source 非法: ${q.annotation_source}`);
    }
    if (!q.slot || !nodes.has(q.slot) || nodes.get(q.slot).type !== 'ExamSlot') {
      errors.push(`${qid} 缺少合法题位节点 slot: ${q.slot}`);
    }

    checkIds(qid, 'models', q.models || [], ['PhysicalModel']);
    checkIds(qid, 'laws', q.laws || [], ['ConceptAndLaw']);
    checkIds(qid, 'experiments', q.experiments || [], ['Experiment']);
    checkIds(qid, 'exp_skills', q.exp_skills || [], ['ExpSkill']);
    checkIds(qid, 'methods', q.methods || [], ['MethodAndTool']);
    checkIds(qid, 'traps', q.traps || [], ['Misconception']);

    const totalCoreRefs = (q.models?.length || 0) + (q.laws?.length || 0) + (q.experiments?.length || 0);
    if (totalCoreRefs === 0) {
      errors.push(`${qid} 必须至少挂载一个核心规律 (laws)、物理模型 (models) 或实验 (experiments)`);
    }

    if (bankQMap) {
      const bq = bankQMap.get(qid);
      if (!bq) {
        errors.push(`${qid} 不属于原卷 ${paperAnnotation.paper_id}`);
      } else {
        if (q.question_sha256 !== bq.fingerprint) {
          errors.push(`${qid} 指纹漂移: 标注绑定 ${q.question_sha256} !== 题库当前 ${bq.fingerprint}`);
        }
        const isNonChoice = bq.type === '实验题' || bq.type === '计算题';
        if (isNonChoice) {
          if (!Array.isArray(q.subquestions) || q.subquestions.length === 0) {
            errors.push(`非选择题 ${qid} (${bq.type}) 必须提供子问级推理链 subquestions`);
          } else {
            for (const sub of q.subquestions) {
              if (!sub.sub_id || !sub.process) {
                errors.push(`${qid} 子问缺少 sub_id 或过程描述 process`);
              }
              checkIds(`${qid}[${sub.sub_id}]`, 'invoked_laws', sub.invoked_laws || [], ['ConceptAndLaw']);
              checkIds(`${qid}[${sub.sub_id}]`, 'exp_skills', sub.exp_skills || [], ['ExpSkill']);
              if ((sub.invoked_laws?.length || 0) + (sub.exp_skills?.length || 0) === 0) {
                errors.push(`${qid}[${sub.sub_id}] 必须至少声明一项调用的规律算子 invoked_laws 或实验微技能 exp_skills`);
              }
            }
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
