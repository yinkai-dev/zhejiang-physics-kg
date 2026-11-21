import path from 'node:path';
import { KG_ROOT, DEFAULT_BANK_ROOT, readJson } from './loader.mjs';

export const HELD_OUT_SPLITS = new Set(['test_id', 'test_ood']);

export class HeldOutTestAccessError extends Error {
  constructor(paperId, split) {
    super(
      `[防泄漏门禁拦截] 试卷 "${paperId}" 属于严格封存测试集 (${split})！在开发与本体调优阶段禁止读取其题面与答案；仅在 K4 终验时显式传入 unlockHeldOutTest=true 方可访问。`
    );
    this.name = 'HeldOutTestAccessError';
    this.paperId = paperId;
    this.split = split;
  }
}

/**
 * 加载 135 卷数据集切分注册表
 * @param {string} root 图谱仓库根目录
 */
export function loadSplits(root = KG_ROOT) {
  return readJson(path.join(root, 'splits', 'dataset-splits.json'));
}

/**
 * 门禁检查：确认当前操作是否有权读取指定试卷内容
 * @param {string} paperId 试卷 ID
 * @param {{root?: string, splitsData?: object, unlockHeldOutTest?: boolean}} options 选项
 */
export function assertPaperReadable(paperId, options = {}) {
  const splitsData = options.splitsData || loadSplits(options.root || KG_ROOT);
  const entry = splitsData.papers.find((p) => p.paper_id === paperId);
  if (!entry) {
    throw new Error(`未知的试卷 ID（未登记在切分清单中）: ${paperId}`);
  }
  if (HELD_OUT_SPLITS.has(entry.split) && !options.unlockHeldOutTest) {
    throw new HeldOutTestAccessError(paperId, entry.split);
  }
  return entry;
}

/**
 * 安全读取题库中的单套试卷详情 JSON（自动经过防泄漏门禁检查）
 * @param {string} paperId 试卷 ID
 * @param {{root?: string, bankRoot?: string, splitsData?: object, unlockHeldOutTest?: boolean}} options 选项
 */
export function readBankPaperSafely(paperId, options = {}) {
  const entry = assertPaperReadable(paperId, options);
  const bankRoot = options.bankRoot || DEFAULT_BANK_ROOT;
  const paperPath = path.join(bankRoot, 'public', 'data', 'papers', `${paperId}.json`);
  const data = readJson(paperPath);
  return { splitEntry: entry, paper: data };
}
