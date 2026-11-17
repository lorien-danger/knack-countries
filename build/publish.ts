/**
 * Make the published dataset (this repo's root) from the full one in ../local: the same columns.json, rows.jsonl
 * and embeddings, but with every flag a link to flag-icons (MIT) on jsDelivr, so the dataset is a few small files
 * that the Knack app can read by this repo's link.
 *   npx tsx publish.ts [out folder]      (default ..)
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const SRC = join(HERE, '../local'), OUT = process.argv[2] ?? join(HERE, '..');

const meta = JSON.parse(await readFile(join(SRC, 'columns.json'), 'utf8'));
meta.practices = [
	{ name: 'Where is it?', show: ['flag', 'name'], ask: 'location' },
	{ name: 'Flags', show: ['flag'], ask: 'name' }
];
const rows = (await readFile(join(SRC, 'rows.jsonl'), 'utf8')).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).map((r) => {
	const code = /flags\/([\w-]+)\.\w+$/.exec(String(r.flag))?.[1];
	if (!code) throw new Error(`${r.id}: no flag code in ${r.flag}`);
	return { ...r, flag: `https://cdn.jsdelivr.net/npm/flag-icons@7.6.0/flags/4x3/${code}.svg` };
});
await mkdir(OUT, { recursive: true });
// the files a column's structure is kept in ("near": which flags look alike, which names sound alike)
for (const c of meta.columns) for (const x of [c, ...(Array.isArray(c.near) ? c.near : c.near ? [c.near] : [])]) if (x.file) await copyFile(join(SRC, x.file), join(OUT, x.file));
await writeFile(join(OUT, 'columns.json'), JSON.stringify(meta, null, 1) + '\n');
await writeFile(join(OUT, 'rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`${OUT}: ${rows.length} rows`);
