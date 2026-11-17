/**
 * Each country's name said aloud: the column "spoken name" of ../local, four Australian voices a name.
 *   npx tsx say.ts            make what is missing, and write the column
 *   npx tsx say.ts --hear     also print what a speech model hears in each recording, to check them by
 *
 * The voices are Google Cloud's en-AU Neural2 (two women, two men), the ones picked by ear for first-words. A voice
 * reads a name its own way, and for some names that is not how the name is said in English (Kiribati, Lesotho).
 * said.tsv lists those: the name, a tab, and how to say it: in IPA between slashes (/ɡrəˈneɪdə/), or as words to
 * read out, any of them with its IPA after it in brackets (Saint Kitts and Nevis[/ˈniːvɪs/]). A recording is made
 * again when its line changes (said.json keeps what each was made from).
 *
 * Needs a Google Cloud key that can use Text-to-Speech: GC_API_KEY, or --env <a .env file with it>; ffmpeg; and for
 * --hear the Knack app checked out beside knack-datasets (or KNACK_APP), whose speech code does the hearing.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = join(HERE, '../local');
const VOICES = ['en-AU-Neural2-A', 'en-AU-Neural2-B', 'en-AU-Neural2-C', 'en-AU-Neural2-D'];
const short = (v: string) => v.replace(/^en-AU-Neural2-/, '').toLowerCase();
const COLUMN = 'spoken name';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
async function apiKey() {
	if (process.env.GC_API_KEY) return process.env.GC_API_KEY;
	const m = /^GC_API_KEY=(.*)$/m.exec(await readFile(arg('--env', '.env'), 'utf8'));
	if (!m) throw new Error('No GC_API_KEY');
	return m[1].trim().replace(/^["']|["']$/g, '');
}
async function pool<T>(items: T[], n: number, f: (x: T) => Promise<void>) {
	let next = 0;
	await Promise.all([...Array(n)].map(async () => { while (next < items.length) await f(items[next++]); }));
}
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const rows: { id: string; name: string }[] = (await readFile(join(OUT, 'rows.jsonl'), 'utf8')).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const said = new Map((await readFile(join(HERE, 'said.tsv'), 'utf8').catch(() => '')).split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split('\t').map((x) => x.trim()) as [string, string]));
for (const n of said.keys()) if (!rows.some((r) => r.name === n)) throw new Error(`said.tsv: no country called ${n}`);

/** what the voice is given for a name: the name, other words to read, or words with their sounds in IPA */
function input(name: string) {
	const how = said.get(name);
	if (!how) return { text: name };
	const phoneme = (word: string, ipa: string) => `<phoneme alphabet="ipa" ph="${xml(ipa)}">${xml(word)}</phoneme>`;
	const whole = /^\/(.+)\/$/.exec(how)?.[1];
	if (whole) return { ssml: `<speak>${phoneme(name, whole)}</speak>` };
	if (!/\[\/.+?\/\]/.test(how)) return { text: how };
	// words, some with IPA after them in brackets
	return { ssml: `<speak>${how.split(/(\S+\[\/.+?\/\])/).map((x) => { const m = /^(\S+)\[\/(.+?)\/\]$/.exec(x); return m ? phoneme(m[1], m[2]) : xml(x); }).join('')}</speak>` };
}

await mkdir(join(OUT, 'media', 'say'), { recursive: true });
const madeFile = join(HERE, 'said.json');
const made: Record<string, string> = JSON.parse(await readFile(madeFile, 'utf8').catch(() => '{}'));
const jobs = rows.flatMap((r) => VOICES.map((v) => ({ r, v, rel: `media/say/${r.id}.${short(v)}.mp3`, from: JSON.stringify(input(r.name)) })));
const missing = jobs.filter((j) => !existsSync(join(OUT, j.rel)) || made[j.rel] !== j.from);
const key = missing.length ? await apiKey() : '';
await pool(missing, 2, async ({ r, v, rel, from }) => {
	for (let wait = 2000; ; wait *= 2) {
		const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ input: JSON.parse(from), voice: { languageCode: 'en-AU', name: v }, audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 } })
		});
		const j = await res.json();
		if (j.audioContent) { await writeFile(join(OUT, rel), Buffer.from(j.audioContent, 'base64')); made[rel] = from; return; }
		// a per-minute quota, and the odd one-off failure: wait and try again
		if (wait < 64000) { await new Promise((ok) => setTimeout(ok, wait)); continue; }
		throw new Error(`${r.name}, voice ${short(v)}: ${JSON.stringify(j).slice(0, 200)}`);
	}
});
await writeFile(madeFile, JSON.stringify(Object.fromEntries(Object.entries(made).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');
console.log(`${jobs.length} recordings (${missing.length} made now)`);

if (process.argv.includes('--hear')) {
	const { decode, listen, transcribe } = await import(join(process.env.KNACK_APP ?? join(HERE, '../../../knack'), 'src/lib/engine/speech.ts'));
	const only = arg('--only', '');
	for (const r of rows) {
		if (only && !only.split(',').includes(r.name)) continue;
		const heard: string[] = [];
		for (const v of VOICES) heard.push((await transcribe(await listen(await decode(join(OUT, `media/say/${r.id}.${short(v)}.mp3`))))).join(''));
		console.log(`${r.name}\t${said.get(r.name) ?? ''}\t${heard.join('\t')}`);
	}
}

// the column, after the name it says, and each row's recordings (a list: each showing plays one of them). It is
// the name in another form ("same"), so a deck that always plays it never plays it with a question asking the name.
const meta = JSON.parse(await readFile(join(OUT, 'columns.json'), 'utf8'));
const name = meta.columns.find((c: { name: string }) => c.name === 'name');
const column = { name: COLUMN, type: 'plain', media: 'audio', same: 'name' };
meta.columns = meta.columns.filter((c: { name: string }) => c.name !== COLUMN);
meta.columns.splice(meta.columns.indexOf(name) + 1, 0, column);
await writeFile(join(OUT, 'columns.json'), JSON.stringify(meta, null, 1) + '\n');
const full = (await readFile(join(OUT, 'rows.jsonl'), 'utf8')).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
await writeFile(join(OUT, 'rows.jsonl'), full.map((r) => {
	const o: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(r)) if (k !== COLUMN) { o[k] = v; if (k === 'name') o[COLUMN] = VOICES.map((v) => `media/say/${r.id}.${short(v)}.mp3`); }
	return JSON.stringify(o);
}).join('\n') + '\n');
