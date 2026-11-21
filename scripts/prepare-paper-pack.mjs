import path from 'node:path';
import { KG_ROOT, DEFAULT_BANK_ROOT } from '../src/loader.mjs';
import { readBankPaperSafely } from '../src/split-guard.mjs';

const args = process.argv.slice(2);
const paperIds = args.filter((a) => !a.startsWith('--'));
const blindQuestionOnly = args.includes('--blind-question-only');
const unlockHeldOutTest = args.includes('--unlock-heldout-test');

function blocksToText(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((b) => {
      if (b.type === 'text') return b.value;
      if (b.type === 'math') return `$${b.value}$`;
      if (b.type === 'score') return `[${b.value}]`;
      if (b.type === 'figure') return `[配图]`;
      if (b.type === 'table') {
        return (
          '[表格: ' +
          b.rows.map((r) => r.map(blocksToText).join(' | ')).join(' ; ') +
          ']'
        );
      }
      return '';
    })
    .join('');
}

function suggestDefaultSlot(totalCount, numberStr, type) {
  const n = Number(numberStr);
  if (type === '实验题') return 'slot.nonchoice.exp_trio';
  if (totalCount === 18) {
    if (n === 1) return 'slot.choice.si_concept';
    if (n >= 2 && n <= 8) return 'slot.choice.mech_core';
    if (n >= 9 && n <= 10) return 'slot.choice.single_capstone';
    if (n === 11) return 'slot.choice.multi_mod_thermo';
    if (n === 12) return 'slot.choice.multi_wave_opt';
    if (n === 13) return 'slot.choice.multi_capstone';
    if (n === 14) return 'slot.nonchoice.exp_trio';
    if (n === 15) return 'slot.nonchoice.calc_thermo';
    if (n === 16) return 'slot.nonchoice.calc_mech';
    if (n === 17) return 'slot.nonchoice.calc_ind';
    if (n === 18) return 'slot.nonchoice.calc_particle';
  }
  if (totalCount === 20) {
    if (n === 1) return 'slot.choice.si_concept';
    if (n >= 2 && n <= 11) return 'slot.choice.mech_core';
    if (n >= 12 && n <= 13) return 'slot.choice.single_capstone';
    if (n === 14) return 'slot.choice.multi_mod_thermo';
    if (n === 15) return 'slot.choice.multi_wave_opt';
    if (n === 16) return 'slot.nonchoice.exp_trio';
    if (n === 17) return 'slot.nonchoice.calc_thermo';
    if (n === 18) return 'slot.nonchoice.calc_mech';
    if (n === 19) return 'slot.nonchoice.calc_ind';
    if (n === 20) return 'slot.nonchoice.calc_particle';
  }
  return type === '计算题' ? 'slot.nonchoice.calc_mech' : 'slot.choice.mech_core';
}

for (const pid of paperIds) {
  const { splitEntry, paper } = readBankPaperSafely(pid, {
    root: KG_ROOT,
    bankRoot: DEFAULT_BANK_ROOT,
    unlockHeldOutTest
  });
  console.log(`================================================================`);
  console.log(`PAPER_ID: ${paper.paper_id} | SPLIT: ${splitEntry.split} | 题数: ${paper.questions.length} | 模式: ${blindQuestionOnly ? 'BLIND_QUESTION_ONLY' : 'ANSWER_GROUNDED'}`);
  console.log(`================================================================`);
  for (const q of paper.questions) {
    const stem = blocksToText(q.body).replace(/\s+/g, ' ').trim();
    const choices = (q.choices || [])
      .map((c, idx) => `${String.fromCharCode(65 + idx)}. ${blocksToText(c).replace(/\s+/g, ' ').trim()}`)
      .join('  ');
    const slotHint = suggestDefaultSlot(paper.questions.length, q.number, q.type);
    console.log(`\n--- Q${q.number} | id: ${q.id} | type: ${q.type} | legacy_topics: ${JSON.stringify(q.topics)} | suggested_slot: ${slotHint} ---`);
    console.log(`题干: ${stem}`);
    if (choices) console.log(`选项: ${choices}`);
    if (!blindQuestionOnly) {
      if (q.answer?.status === 'source') {
        const ansBody = blocksToText(q.answer.body).replace(/\s+/g, ' ').trim();
        console.log(`原卷答案: ${q.answer.key ? `[选项 ${q.answer.key}] ` : ''}${ansBody}`);
      } else if (q.ai_reference) {
        const aiBody = blocksToText(q.ai_reference.body).replace(/\s+/g, ' ').trim();
        console.log(`AI参考答案: ${q.ai_reference.conditional_key ? `[${q.ai_reference.conditional_key}] ` : ''}${aiBody}`);
      } else {
        console.log(`答案状态: ${q.answer_status}（无标准答案文本）`);
      }
    }
  }
}
