/**
 * Draw each flag of ../rows.jsonl (in that order) to a 640x480 PNG, the same way build.ts does, for embed.py.
 *   npx tsx render-flags.ts <out folder>      writes <id>.png for every row
 */
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const HERE = new URL('.', import.meta.url).pathname;
const out = process.argv[2];
if (!out) { console.error('usage: render-flags.ts <out folder>'); process.exit(1); }
await mkdir(out, { recursive: true });
const rows = (await readFile(join(HERE, '../rows.jsonl'), 'utf8')).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
for (const r of rows) {
	const code = /flags\/4x3\/([\w-]+)\.svg$/.exec(r.flag)?.[1];
	if (!code) throw new Error(`${r.id}: no flag code in ${r.flag}`);
	const svg = await readFile(join(HERE, 'node_modules/flag-icons/flags/4x3', `${code}.svg`));
	await sharp(svg, { density: 300 }).resize(640, 480).png().toFile(join(out, `${r.id}.png`));
}
console.log(`${rows.length} flags -> ${out}`);
