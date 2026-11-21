import fs from 'node:fs';
import path from 'node:path';
import { KG_ROOT, loadOntology, loadPaperAnnotations, sha256 } from './loader.mjs';
import { validateOntology } from './validator.mjs';

/**
 * 计算每个概念规律、物理模型、实验的先修规律闭包与最小必需教材节次集合
 * @param {ReturnType<typeof loadOntology>} ontology
 */
export function computeClosures(ontology) {
  const { nodes, laws, models, experiments } = ontology;
  const lawPrereqClosure = new Map();
  const requiredUnits = new Map();

  // 1. 计算 law 的先修规律闭包与所需教材节次
  function getLawClosure(lawId, visiting = new Set()) {
    if (lawPrereqClosure.has(lawId)) return lawPrereqClosure.get(lawId);
    if (visiting.has(lawId)) return new Set();
    visiting.add(lawId);
    const law = nodes.get(lawId);
    const closure = new Set();
    const units = new Set();
    if (law?.unit) units.add(law.unit);
    for (const preId of law?.requires_prereq || []) {
      closure.add(preId);
      for (const sub of getLawClosure(preId, visiting)) closure.add(sub);
      for (const u of requiredUnits.get(preId) || []) units.add(u);
    }
    lawPrereqClosure.set(lawId, closure);
    requiredUnits.set(lawId, units);
    return closure;
  }

  for (const law of laws) getLawClosure(law.id);

  // 2. 计算 model 的子变式树（HAS_VARIANT 用于专题检索向下展开，各模型自身显式声明 applies_law 不隐式混入母模型专属规律）
  const variantChildren = new Map();
  for (const m of models) {
    variantChildren.set(m.id, []);
  }
  for (const m of models) {
    for (const vId of m.has_variant || []) {
      variantChildren.get(m.id).push(vId);
    }
  }

  const modelLawClosure = new Map();
  function getModelLaws(modelId) {
    if (modelLawClosure.has(modelId)) return modelLawClosure.get(modelId);
    const m = nodes.get(modelId);
    const allLaws = new Set();
    const units = new Set();
    for (const lawId of m?.applies_law || []) {
      allLaws.add(lawId);
      for (const pre of getLawClosure(lawId)) allLaws.add(pre);
    }
    for (const lawId of allLaws) {
      for (const u of requiredUnits.get(lawId) || []) units.add(u);
    }
    modelLawClosure.set(modelId, allLaws);
    requiredUnits.set(modelId, units);
    return allLaws;
  }

  for (const m of models) getModelLaws(m.id);

  // 计算每个模型的全部后代变式集合（含自身）
  const variantSubtree = new Map();
  function getSubtree(modelId) {
    if (variantSubtree.has(modelId)) return variantSubtree.get(modelId);
    const s = new Set([modelId]);
    for (const childId of variantChildren.get(modelId) || []) {
      for (const sub of getSubtree(childId)) s.add(sub);
    }
    variantSubtree.set(modelId, s);
    return s;
  }
  for (const m of models) getSubtree(m.id);

  // 3. 计算实验所需的最小教材节次集合
  for (const exp of experiments) {
    const units = new Set();
    if (exp.unit) units.add(exp.unit);
    for (const lawId of exp.applies_law || []) {
      for (const u of requiredUnits.get(lawId) || []) units.add(u);
    }
    requiredUnits.set(exp.id, units);
  }

  return {
    lawPrereqClosure,
    modelLawClosure,
    requiredUnits,
    variantSubtree
  };
}

/**
 * 渲染 ~4K Tokens 级高信噪比全景导航地图 L0-map.md
 */
export function renderL0Map(ontology, closures, questionStats) {
  const { meta, unitsRaw, laws, models, experiments, expSkills, methods, traps, slots } = ontology;
  const lines = [];
  lines.push(`# 浙江高考物理知识图谱 L0 全景路由地图 (v${meta.ontology_version})`);
  lines.push('');
  lines.push(`> 节点总数: ${ontology.nodes.size} | 教材: 6册/${unitsRaw.length}章 | 概念规律: ${laws.length} | 物理模型: ${models.length} | 实验与微技能: ${experiments.length + expSkills.length} | 方法图像数学: ${methods.length} | 迷思陷阱: ${traps.length} | 题位簇: ${slots.length} | 已挂载题目: ${questionStats.annotatedQuestions}`);
  lines.push('> 调用指南: 先在本图定位目标节点语义 ID，再按需用 `kg-cli inspect <id>` 拉取公式/适用条件/易混辨析，或用 `kg-cli scope` / `kg-cli match` 执行零超纲选题。');
  lines.push('');

  lines.push('## 1. 教材六册与 27 章速查 (`unit.*`)');
  const byBook = new Map();
  for (const ch of unitsRaw) {
    if (!byBook.has(ch.book_id)) byBook.set(ch.book_id, { title: ch.book_title, chapters: [] });
    byBook.get(ch.book_id).chapters.push(`${ch.id}(${ch.title.replace(/^第[一二三四五六七八九十]+章\s*/, '')}, ${ch.sections.length}节)`);
  }
  for (const [bookId, info] of byBook.entries()) {
    lines.push(`- **${bookId} ${info.title}**: ${info.chapters.join(' · ')}`);
  }
  lines.push('');

  lines.push(`## 2. 18 个二级专题与 ${laws.length} 个概念规律算子 (\`law.*\`)`);
  const lawsByMod = new Map();
  for (const l of laws) {
    if (!lawsByMod.has(l.module)) lawsByMod.set(l.module, []);
    lawsByMod.get(l.module).push(`\`${l.id}\` ${l.title}`);
  }
  for (const [mod, items] of lawsByMod.entries()) {
    lines.push(`- **${mod}**: ${items.join(' | ')}`);
  }
  lines.push('');

  lines.push(`## 3. 6 大模型族与 ${models.length} 个浙江经典物理模型 (\`model.*\`)`);
  const modelsByFam = new Map();
  for (const m of models) {
    if (!modelsByFam.has(m.family)) modelsByFam.set(m.family, []);
    modelsByFam.get(m.family).push(`\`${m.id}\` ${m.title}`);
  }
  for (const [fam, items] of modelsByFam.entries()) {
    lines.push(`- **${fam}**: ${items.join(' | ')}`);
  }
  lines.push('');

  lines.push(`## 4. ${experiments.length} 个学生实验 (\`exp.*\`) 与 ${expSkills.length} 个实验微技能 (\`expskill.*\`)`);
  for (const dom of ['力学实验', '电学实验', '光学与热学实验']) {
    const list = experiments.filter((e) => e.domain === dom).map((e) => `\`${e.id}\` ${e.title}`);
    lines.push(`- **${dom}**: ${list.join(' | ')}`);
  }
  for (const cat of ['仪器读数', '实验操作', '电路设计', '数据处理与误差']) {
    const list = expSkills.filter((s) => s.category === cat).map((s) => `\`${s.id}\` ${s.title}`);
    lines.push(`- **微技能·${cat}**: ${list.join(' | ')}`);
  }
  lines.push('');

  lines.push(`## 5. ${methods.length} 个思想方法、物理图像与数学工具 (\`method.*\`)`);
  for (const cat of ['思想方法', '物理图像', '数学与几何工具']) {
    const list = methods.filter((m) => m.category === cat).map((m) => `\`${m.id}\` ${m.title}`);
    lines.push(`- **${cat}**: ${list.join(' | ')}`);
  }
  lines.push('');

  lines.push(`## 6. ${slots.length} 个浙江选考功能题位簇 (\`slot.*\`)`);
  lines.push(slots.map((s) => `- \`${s.id}\`: ${s.title} [18题卷:${s.paper_18_numbers.join(',')} / 20题卷:${s.paper_20_numbers.join(',')}]`).join('\n'));
  lines.push('');

  return lines.join('\n');
}

/**
 * 编译全套图谱产物（dist/kg-bundle.json, dist/agent/*, dist/web/kg-nav.json, skill/references/L0-map.md）
 */
export function buildKnowledgeGraph(root = KG_ROOT) {
  const ontology = loadOntology(root);
  const check = validateOntology(ontology);
  if (!check.ok) {
    throw new Error(`本体门禁校验未通过:\n${check.errors.join('\n')}`);
  }

  const closures = computeClosures(ontology);
  const annotationsMap = loadPaperAnnotations(root);

  // 聚合已挂载题目的节点索引
  const nodeQuestions = new Map();
  const questionAnnotations = {};
  let annotatedQuestions = 0;

  const pushHit = (nodeId, qid) => {
    if (!nodeQuestions.has(nodeId)) nodeQuestions.set(nodeId, new Set());
    nodeQuestions.get(nodeId).add(qid);
  };

  for (const [, paperAnn] of annotationsMap.entries()) {
    for (const q of paperAnn.questions || []) {
      annotatedQuestions++;
      const requiredForQuestion = new Set();
      const allDirectNodes = [
        ...(q.models || []),
        ...(q.laws || []),
        ...(q.experiments || []),
        ...(q.exp_skills || []),
        ...(q.methods || []),
        ...(q.traps || []),
        ...(q.slot ? [q.slot] : []),
        ...(q.subquestions || []).flatMap((s) => [...(s.invoked_laws || []), ...(s.exp_skills || [])])
      ];
      for (const nid of allDirectNodes) {
        pushHit(nid, q.question_id);
        for (const u of closures.requiredUnits.get(nid) || []) requiredForQuestion.add(u);
      }
      // 模型与规律的隐式先修规律也建立可追溯关联
      for (const mid of q.models || []) {
        for (const lid of closures.modelLawClosure.get(mid) || []) pushHit(lid, q.question_id);
      }
      questionAnnotations[q.question_id] = {
        ...q,
        paper_id: paperAnn.paper_id,
        required_units: [...requiredForQuestion].sort()
      };
    }
  }

  const serializedNodes = {};
  for (const [id, node] of ontology.nodes.entries()) {
    serializedNodes[id] = {
      ...node,
      prereq_laws: closures.lawPrereqClosure.has(id)
        ? [...closures.lawPrereqClosure.get(id)].sort()
        : closures.modelLawClosure.has(id)
          ? [...closures.modelLawClosure.get(id)].sort()
          : undefined,
      required_units: closures.requiredUnits.has(id) ? [...closures.requiredUnits.get(id)].sort() : undefined,
      variant_subtree: closures.variantSubtree.has(id) && closures.variantSubtree.get(id).size > 1
        ? [...closures.variantSubtree.get(id)].sort()
        : undefined,
      question_count: nodeQuestions.has(id) ? nodeQuestions.get(id).size : 0
    };
  }

  const bundlePayload = {
    schema_version: ontology.meta.schema_version,
    ontology_version: ontology.meta.ontology_version,
    counts: {
      ...check.counts,
      annotated_papers: annotationsMap.size,
      annotated_questions: annotatedQuestions
    },
    nodes: serializedNodes,
    edges: ontology.edges,
    node_questions: Object.fromEntries(
      [...nodeQuestions.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, set]) => [k, [...set].sort()])
    ),
    questions: questionAnnotations
  };
  const bundleVersion = sha256(bundlePayload);
  const bundle = { version: bundleVersion, ...bundlePayload };

  const distDir = path.join(root, 'dist');
  const agentDir = path.join(distDir, 'agent');
  const webDir = path.join(distDir, 'web');
  const l1Dir = path.join(agentDir, 'L1-modules');
  fs.mkdirSync(l1Dir, { recursive: true });
  fs.mkdirSync(webDir, { recursive: true });

  fs.writeFileSync(path.join(distDir, 'kg-bundle.json'), JSON.stringify(bundle, null, 2) + '\n');

  const l0Text = renderL0Map(ontology, closures, { annotatedQuestions });
  fs.writeFileSync(path.join(agentDir, 'L0-map.md'), l0Text + '\n');

  const trapsLines = ['# 高频审题陷阱与认知迷思速查表 (`trap.*`)\n'];
  for (const t of ontology.traps) {
    trapsLines.push(`- \`${t.id}\` [${t.domain}] ${t.title}`);
  }
  fs.writeFileSync(path.join(agentDir, 'traps-index.md'), trapsLines.join('\n') + '\n');

  // 同步一份 L0-map 与 traps-index 到 skill/references/
  const skillRefDir = path.join(root, 'skill', 'references');
  fs.mkdirSync(skillRefDir, { recursive: true });
  fs.writeFileSync(path.join(skillRefDir, 'L0-map.md'), l0Text + '\n');
  fs.writeFileSync(path.join(skillRefDir, 'traps-index.md'), trapsLines.join('\n') + '\n');

  // 输出面向题库网站前端的轻量四维导航投影 (章节 / 考点规律 / 物理模型 / 必做实验)
  const webNav = {
    schema_version: 1,
    version: bundleVersion,
    ontology_version: ontology.meta.ontology_version,
    annotated_questions: annotatedQuestions,
    tabs: {
      curriculum: ontology.unitsRaw.map((ch) => ({
        id: ch.id,
        book_id: ch.book_id,
        book_title: ch.book_title,
        title: ch.title,
        topics: ch.topics,
        sections: ch.sections.map((s) => ({
          id: s.id,
          title: s.title,
          topics: s.topics
        }))
      })),
      laws: ontology.laws.map((l) => ({
        id: l.id,
        module: l.module,
        title: l.title,
        topics: l.topics,
        unit: l.unit,
        formulas: l.formulas,
        question_count: serializedNodes[l.id].question_count
      })),
      models: ontology.models.map((m) => ({
        id: m.id,
        family: m.family,
        title: m.title,
        topics: m.topics,
        slots: m.appears_in_slot,
        question_count: serializedNodes[m.id].question_count
      })),
      experiments: ontology.experiments.map((e) => ({
        id: e.id,
        domain: e.domain,
        title: e.title,
        topics: e.topics,
        unit: e.unit,
        mandatory: e.curriculum_mandatory,
        question_count: serializedNodes[e.id].question_count
      }))
    },
    node_questions: bundle.node_questions
  };
  fs.writeFileSync(path.join(webDir, 'kg-nav.json'), JSON.stringify(webNav, null, 2) + '\n');

  return {
    version: bundleVersion,
    counts: bundle.counts,
    l0Chars: l0Text.length
  };
}
