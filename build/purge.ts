/**
 * After pushing new or changed recordings: tell jsDelivr, which serves this repo's media to the Knack app, to fetch
 * them again. Without this it goes on answering from the version it last looked up, for hours: new files are not
 * found and changed ones are the old ones.
 *   npx tsx purge.ts
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const REPO = 'lorien-danger/knack-countries';
const files = (await readdir(join(HERE, '../media/say'))).map((f) => `/gh/${REPO}@latest/media/say/${f}`);
let done = 0;
for (let i = 0; i < files.length; i += 20) {
	const r = await fetch('https://purge.jsdelivr.net/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: files.slice(i, i + 20) }) });
	if (!r.ok) throw new Error(`jsDelivr would not purge: ${r.status} ${(await r.text()).slice(0, 200)}`);
	done += Math.min(20, files.length - i);
	await new Promise((ok) => setTimeout(ok, 1500));
}
console.log(`${done} files purged`);
