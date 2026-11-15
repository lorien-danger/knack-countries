/**
 * Build data/countries: one row per country, with its name, flag, where it is (its shape), its region, its population
 * and its size.
 *   cd build && npm install && npx tsx build.ts [out folder]      (default ../local)
 * Then describe the flags and the names (adds "flag look" and "name sound" embeddings, so the app can tell which flags
 * look alike and which names are spelled or sound alike - Niger and Nigeria, Austria and Australia):
 *   (in the Knack app) npm run describe -- <this repo>/local flag
 *   (in the Knack app) npm run describe -- <this repo>/local name
 * and publish.ts makes the published dataset (this repo's root) from ../local.
 *
 * Shapes and populations (estimates, mostly 2019): Natural Earth 1:50m admin-0 countries (public domain). Sizes:
 * mledoze/countries (ODbL), as the 1:50m shapes lose small islands and split Western Sahara. Flags: the flag-icons
 * package (MIT), drawn to PNG. Populations and sizes are log-scale numbers: being off is a ratio.
 * Countries are the sovereign states plus the states whose recognition is disputed (Kosovo, Palestine, Taiwan,
 * Western Sahara); dependencies are left out, and so are the few places with no flag in flag-icons.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { geoArea } from 'd3-geo';
import sharp from 'sharp';

const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const SIZES = 'https://raw.githubusercontent.com/mledoze/countries/master/countries.json';
const HERE = new URL('.', import.meta.url).pathname;
const FLAGS = join(HERE, 'node_modules/flag-icons/flags/4x3');
const OUT = process.argv[2] ?? join(HERE, '../local');
const KEEP = new Set(['Sovereign country', 'Sovereignty', 'Disputed', 'Indeterminate']);
const LEAVE_OUT = new Set(['AQ', 'IO', 'FK']);
const NAMES: Record<string, string> = {
	US: 'United States', TZ: 'Tanzania', RS: 'Serbia', BS: 'Bahamas', SZ: 'Eswatini', FM: 'Micronesia',
	ST: 'São Tomé and Príncipe'
};

const ne = JSON.parse(await (await fetch(SOURCE)).text());
const km2 = new Map<string, number>((await (await fetch(SIZES)).json()).map((c: { cca2: string; area: number }) => [c.cca2, c.area]));

/** d3-geo wants exterior rings clockwise and holes anticlockwise: a ring wound the wrong way encloses the rest of
 * the globe. Coordinates are rounded to about 100 m. */
function wind(geom: { type: string; coordinates: any }) {
	const polys: number[][][][] = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
	const fixed = polys.map((rings) => rings.map((ring, k) => {
		const r = ring.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]);
		const big = geoArea({ type: 'Polygon', coordinates: [r] }) > 2 * Math.PI;
		return big === (k === 0) ? r.reverse() : r;
	}));
	return fixed.length === 1 ? { type: 'Polygon', coordinates: fixed[0] } : { type: 'MultiPolygon', coordinates: fixed };
}

await mkdir(join(OUT, 'media', 'flags'), { recursive: true });
const rows = [];
for (const f of ne.features) {
	const p = f.properties, code = String(p.ISO_A2_EH);
	if (!(KEEP.has(p.TYPE) || (p.TYPE === 'Country' && p.ADMIN === p.SOVEREIGNT)) || LEAVE_OUT.has(code)) continue;
	const svg = join(FLAGS, `${code.toLowerCase()}.svg`);
	if (!existsSync(svg)) { console.log(`no flag: ${p.ADMIN}`); continue; }
	const flag = `media/flags/${code.toLowerCase()}.png`;
	await sharp(await readFile(svg), { density: 300 }).resize(640, 480).png().toFile(join(OUT, flag));
	const name = NAMES[code] ?? p.ADMIN;
	rows.push({
		id: code.toLowerCase(), name, flag, location: wind(f.geometry), region: [p.REGION_UN, p.SUBREGION],
		population: p.POP_EST > 0 ? p.POP_EST : null, 'size (km²)': km2.get(code) || null
	});
}
rows.sort((a, b) => a.name.localeCompare(b.name));

const meta = {
	name: 'Countries',
	item: 'country',
	practices: [{ show: ['flag', 'name'], ask: 'location' }, { show: ['flag'], ask: 'name' }],
	columns: [
		{ name: 'name', type: 'plain' },
		{ name: 'flag', type: 'plain', media: 'image', icon: true },
		{ name: 'location', type: 'area' },
		{ name: 'region', type: 'tree' },
		{ name: 'population', type: 'number', scale: 'log' },
		{ name: 'size (km²)', type: 'number', scale: 'log' }
	]
};
await writeFile(join(OUT, 'columns.json'), JSON.stringify(meta, null, 1));
await writeFile(join(OUT, 'rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
for (const c of ['population', 'size (km²)'] as const) for (const r of rows) if (r[c] == null) console.log(`no ${c}: ${r.name}`);
console.log(`${rows.length} countries -> ${OUT}`);
