import { KG_ROOT } from '../src/loader.mjs';
import {
  loadBundle,
  locateNodes,
  inspectNodes,
  computeCurriculumScope,
  matchQuestions,
  diagnoseError,
  buildBlueprint
} from '../src/engine.mjs';
import { loadSplits, readBankPaperSafely } from '../src/split-guard.mjs';

const [, , cmd, ...args] = process.argv;

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

const splitCsv = (v) => (typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

const { flags, positional } = parseFlags(args);
const bundle = loadBundle(KG_ROOT);

switch (cmd) {
  case 'stats': {
    const splits = loadSplits(KG_ROOT);
    console.log(JSON.stringify({ version: bundle.version, ontology_version: bundle.ontology_version, counts: bundle.counts, splits: splits.summary }, null, 2));
    break;
  }
  case 'locate': {
    const query = positional.join(' ') || flags.query || '';
    const types = splitCsv(flags.types);
    console.log(JSON.stringify(locateNodes(bundle, { query, types, topic: flags.topic, limit: Number(flags.limit || 15) }), null, 2));
    break;
  }
  case 'inspect': {
    const ids = positional.length ? positional : splitCsv(flags.ids);
    console.log(JSON.stringify(inspectNodes(bundle, ids), null, 2));
    break;
  }
  case 'scope': {
    const units = positional.length ? positional : splitCsv(flags.units);
    console.log(JSON.stringify(computeCurriculumScope(bundle, units), null, 2));
    break;
  }
  case 'match': {
    console.log(
      JSON.stringify(
        matchQuestions(bundle, {
          mustNodes: splitCsv(flags.must),
          anyNodes: splitCsv(flags.any),
          excludeNodes: splitCsv(flags.exclude),
          learnedSelectors: flags.learned ? splitCsv(flags.learned) : null,
          slot: flags.slot || null,
          paperId: flags.paper || null,
          limit: Number(flags.limit || 30)
        }),
        null,
        2
      )
    );
    break;
  }
  case 'diagnose': {
    console.log(
      JSON.stringify(
        diagnoseError(bundle, {
          questionId: flags.question || null,
          trapQuery: positional.join(' ') || flags.query || ''
        }),
        null,
        2
      )
    );
    break;
  }
  case 'blueprint': {
    console.log(
      JSON.stringify(
        buildBlueprint(bundle, {
          mode: flags.mode || 'zhejiang_18_mock',
          focusNodeIds: splitCsv(flags.focus),
          learnedSelectors: flags.learned ? splitCsv(flags.learned) : null
        }),
        null,
        2
      )
    );
    break;
  }
  case 'read-paper': {
    const paperId = positional[0] || flags.paper;
    const res = readBankPaperSafely(paperId, {
      root: KG_ROOT,
      unlockHeldOutTest: Boolean(flags['unlock-heldout-test'])
    });
    console.log(JSON.stringify({ split: res.splitEntry.split, paper_id: res.paper.paper_id, question_count: res.paper.questions.length }, null, 2));
    break;
  }
  default: {
    console.log(`用法: node scripts/cli.mjs <stats|locate|inspect|scope|match|diagnose|blueprint|read-paper> [参数]`);
    process.exit(cmd ? 1 : 0);
  }
}
