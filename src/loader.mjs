import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const KG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_BANK_ROOT = process.env.ZJ_PHYSICS_BANK_ROOT || 'D:/yinkai_self/yinkai的浙江高考物理题库';

/**
 * 读取并解析 JSON 文件
 * @param {string} filePath 文件路径
 */
export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * 计算字符串或对象的稳定 SHA256
 * @param {string|object} value 输入值
 */
export function sha256(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 加载完整本体并构建统一节点表与有向属性边表
 * @param {string} root 图谱仓库根目录
 */
export function loadOntology(root = KG_ROOT) {
  const ontoDir = path.join(root, 'ontology');
  const meta = readJson(path.join(ontoDir, 'meta.json'));
  const unitsRaw = readJson(path.join(ontoDir, 'units.json'));
  const laws = readJson(path.join(ontoDir, 'laws.json'));
  const models = readJson(path.join(ontoDir, 'models.json'));
  const experiments = readJson(path.join(ontoDir, 'experiments.json'));
  const methods = readJson(path.join(ontoDir, 'methods.json'));
  const traps = readJson(path.join(ontoDir, 'traps.json'));
  const slots = readJson(path.join(ontoDir, 'slots.json'));

  const nodes = new Map();
  const edges = [];

  const addNode = (node) => {
    nodes.set(node.id, node);
  };
  const addEdge = (from, to, type, props = {}) => {
    edges.push({ from, to, type, ...props });
  };

  // 展开章与节两级教材单元
  for (const ch of unitsRaw) {
    const { sections = [], ...chapterNode } = ch;
    addNode({ ...chapterNode, section_ids: sections.map((s) => s.id) });
    for (const sec of sections) {
      addNode({
        id: sec.id,
        type: 'CurriculumUnit',
        level: 'section',
        book_id: ch.book_id,
        book_title: ch.book_title,
        chapter_id: ch.id,
        chapter_title: ch.title,
        order: sec.order,
        title: sec.title,
        topics: sec.topics
      });
    }
  }

  for (const law of laws) {
    addNode(law);
    if (law.unit) addEdge(law.id, law.unit, 'BELONGS_TO_UNIT', { primary: true });
    for (const pre of law.requires_prereq || []) {
      addEdge(law.id, pre, 'REQUIRES_PREREQ', { level: 'hard' });
    }
  }

  for (const model of models) {
    addNode(model);
    for (const lawId of model.applies_law || []) {
      addEdge(model.id, lawId, 'APPLIES_LAW');
    }
    for (const methodId of model.uses_method || []) {
      addEdge(model.id, methodId, 'USES_METHOD');
    }
    for (const variantId of model.has_variant || []) {
      addEdge(model.id, variantId, 'HAS_VARIANT');
    }
    for (const c of model.contrasts_with || []) {
      addEdge(model.id, c.target, 'CONTRASTS_WITH', { distinction: c.distinction });
      addEdge(c.target, model.id, 'CONTRASTS_WITH', { distinction: c.distinction });
    }
    for (const trapId of model.triggers_trap || []) {
      addEdge(model.id, trapId, 'TRIGGERS_TRAP');
    }
    for (const slotId of model.appears_in_slot || []) {
      addEdge(model.id, slotId, 'APPEARS_IN_SLOT');
    }
  }

  for (const item of experiments) {
    addNode(item);
    if (item.type === 'Experiment') {
      if (item.unit) addEdge(item.id, item.unit, 'BELONGS_TO_UNIT', { primary: true });
      for (const lawId of item.applies_law || []) addEdge(item.id, lawId, 'APPLIES_LAW');
      for (const skillId of item.common_skills || []) addEdge(item.id, skillId, 'REQUIRES_PREREQ', { level: 'soft' });
      for (const trapId of item.triggers_trap || []) addEdge(item.id, trapId, 'TRIGGERS_TRAP');
      for (const slotId of item.appears_in_slot || []) addEdge(item.id, slotId, 'APPEARS_IN_SLOT');
    }
  }

  for (const method of methods) addNode(method);

  for (const trap of traps) {
    addNode(trap);
    for (const targetId of trap.remediated_by || []) {
      addEdge(trap.id, targetId, 'REMEDIATED_BY');
    }
  }

  for (const slot of slots) addNode(slot);

  return {
    meta,
    unitsRaw,
    laws,
    models,
    experiments: experiments.filter((e) => e.type === 'Experiment'),
    expSkills: experiments.filter((e) => e.type === 'ExpSkill'),
    methods,
    traps,
    slots,
    nodes,
    edges
  };
}

/**
 * 加载所有已落盘的试卷图谱标注文件
 * @param {string} root 图谱仓库根目录
 */
export function loadPaperAnnotations(root = KG_ROOT) {
  const papersDir = path.join(root, 'annotations', 'papers');
  if (!fs.existsSync(papersDir)) return new Map();
  const map = new Map();
  for (const file of fs.readdirSync(papersDir).filter((f) => f.endsWith('.json')).sort()) {
    const data = readJson(path.join(papersDir, file));
    map.set(data.paper_id, data);
  }
  return map;
}
