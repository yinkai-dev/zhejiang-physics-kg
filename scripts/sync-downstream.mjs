import fs from 'node:fs';
import path from 'node:path';
import { KG_ROOT, DEFAULT_BANK_ROOT, readJson } from '../src/loader.mjs';

const dryRun = process.argv.includes('--dry-run');
const webNavSrc = path.join(KG_ROOT, 'dist', 'web', 'kg-nav.json');
const bundleSrc = path.join(KG_ROOT, 'dist', 'kg-bundle.json');

if (!fs.existsSync(webNavSrc) || !fs.existsSync(bundleSrc)) {
  throw new Error('请先运行 npm run build 生成 dist 产物');
}

const nav = readJson(webNavSrc);
const targetWebPath = path.join(DEFAULT_BANK_ROOT, 'public', 'data', 'kg', 'kg-nav.json');

const plan = {
  dry_run: dryRun,
  version: nav.version,
  ontology_version: nav.ontology_version,
  annotated_questions: nav.annotated_questions,
  exports: [
    {
      from: webNavSrc,
      to: targetWebPath,
      bytes: fs.statSync(webNavSrc).size
    }
  ]
};

if (!dryRun) {
  fs.mkdirSync(path.dirname(targetWebPath), { recursive: true });
  fs.copyFileSync(webNavSrc, targetWebPath);
}

console.log(JSON.stringify(plan, null, 2));
