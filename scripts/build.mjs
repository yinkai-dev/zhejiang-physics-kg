import { KG_ROOT } from '../src/loader.mjs';
import { buildKnowledgeGraph } from '../src/compiler.mjs';

const result = buildKnowledgeGraph(KG_ROOT);
console.log(JSON.stringify({ ok: true, ...result }, null, 2));
