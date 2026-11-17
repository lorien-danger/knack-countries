/**
 * Each country's name said aloud: the column "spoken name" of ../local. The English name, read in the accent of the
 * country: by Google Cloud's Chirp 3 HD voices of the country's own language where there is one, else of the nearest
 * there is (voices.tsv says which for each country). Four recordings a name, two women and two men, and not the
 * same four speakers from one country to the next.
 *   npx tsx say.ts            make what is missing, and write the column
 *   npx tsx say.ts --hear     also print what a speech model hears in each recording, to check them by
 *
 * How a name is said:
 *   said.tsv      the name's sounds in IPA, for voices that are English (en-AU, en-GB, en-US, en-IN): they would
 *                 otherwise read some names their own way (Grenada like Granada, Kiribati as it is spelled). The
 *                 name, a tab, then /IPA/ for a one-word name, or the words with IPA after any of them in brackets
 *                 (Saint Kitts and Nevis[/ˈniːvɪs/]). The IPA is in the sounds Google lists for en-AU
 *                 (docs.cloud.google.com/text-to-speech/docs/phonemes); a voice that will not take one says the
 *                 name unaided, and that is reported.
 *   respell.tsv   for any other voice, which reads the English name as its own language would: the name, a tab, the
 *                 voice language, a tab, and other letters to read where what it makes of the name is not the name.
 * A recording is made again when what it is made from changes (said.json keeps that), and recordings no country
 * has any more are removed.
 *
 * Needs a Google Cloud key that can use Text-to-Speech: GC_API_KEY, or --env <a .env file with it>; and for --hear
 * ffmpeg and the Knack app checked out beside knack-datasets (or KNACK_APP), whose speech code does the hearing.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = join(HERE, '../local');
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
const table = async (file: string) => (await readFile(join(HERE, file), 'utf8').catch(() => '')).split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split('\t').map((x) => x.trim()));

const rows: { id: string; name: string }[] = (await readFile(join(OUT, 'rows.jsonl'), 'utf8')).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const said = new Map((await table('said.tsv')).map(([name, how]) => [name, how]));
const respell = new Map((await table('respell.tsv')).map(([name, locale, text]) => [`${name}\t${locale}`, text]));
const localeOf = new Map((await table('voices.tsv')).map(([id, locale]) => [id, locale]));
for (const n of said.keys()) if (!rows.some((r) => r.name === n)) throw new Error(`said.tsv: no country called ${n}`);
for (const r of rows) if (!localeOf.has(r.id)) throw new Error(`voices.tsv: no voice language for ${r.name} (${r.id})`);

const key = await apiKey();
// the speakers each voice language has, women and men, in a fixed order
const speakers = new Map<string, { f: string[]; m: string[] }>();
for (const v of (await (await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${key}`)).json()).voices as { name: string; ssmlGender: string }[]) {
	const m = /^(.+)-Chirp3-HD-(.+)$/.exec(v.name);
	if (!m) continue;
	const s = speakers.get(m[1]) ?? { f: [], m: [] };
	(v.ssmlGender === 'FEMALE' ? s.f : s.m).push(m[2]);
	speakers.set(m[1], s);
}
for (const s of speakers.values()) { s.f.sort(); s.m.sort(); }
const locales = [...new Set(localeOf.values())].sort();
for (const l of locales) if (!speakers.get(l)?.f.length || !speakers.get(l)?.m.length) throw new Error(`voices.tsv: there are no Chirp 3 HD voices for ${l}`);

/** a country's four speakers: the next two women and two men of its voice language after the last country's that
 * shares it, starting somewhere different in each language */
const turn = new Map<string, number>();
function speakersFor(locale: string) {
	const k = turn.get(locale) ?? 0, s = speakers.get(locale)!, start = locales.indexOf(locale) * 3;
	turn.set(locale, k + 1);
	return [s.f[(start + 2 * k) % s.f.length], s.f[(start + 2 * k + 1) % s.f.length], s.m[(start + 2 * k) % s.m.length], s.m[(start + 2 * k + 1) % s.m.length]];
}

/** what a voice is given for a name: the name; for an English voice, with the sounds of the words said.tsv has; for
 * another, other letters to read where respell.tsv has them */
function input(name: string, locale: string) {
	if (!locale.startsWith('en-')) return { text: respell.get(`${name}\t${locale}`) ?? name };
	const how = said.get(name);
	if (!how) return { text: name };
	const whole = /^\/(.+)\/$/.exec(how)?.[1];
	// (the British voices have the long a of "bath" as ɑː, where the Australian have ɐː)
	const sounds = (ipa: string) => (locale === 'en-GB' ? ipa.replaceAll('ɐː', 'ɑː') : ipa);
	const words = (whole ? [[name, whole]] : [...how.matchAll(/([^\s[\]-]+)\[\/(.+?)\/\]/g)].map((m) => [m[1], m[2]])).map(([w, ipa]) => [w, sounds(ipa)]);
	return { text: name, customPronunciations: { pronunciations: words.map(([phrase, pronunciation]) => ({ phrase, phoneticEncoding: 'PHONETIC_ENCODING_IPA', pronunciation })) } };
}

await mkdir(join(OUT, 'media', 'say'), { recursive: true });
const madeFile = join(HERE, 'said.json');
const made: Record<string, string> = JSON.parse(await readFile(madeFile, 'utf8').catch(() => '{}'));
const jobs = rows.flatMap((r) => {
	const locale = localeOf.get(r.id)!;
	return speakersFor(locale).map((who) => ({ r, voice: `${locale}-Chirp3-HD-${who}`, locale, rel: `media/say/${r.id}.${who.toLowerCase()}.mp3`, from: JSON.stringify({ voice: `${locale}-Chirp3-HD-${who}`, ...input(r.name, locale) }) }));
});
const missing = jobs.filter((j) => !existsSync(join(OUT, j.rel)) || (made[j.rel] !== j.from && made[j.rel] !== `${j.from} unaided`));
const unaided: string[] = [];
await pool(missing, 3, async ({ r, voice, locale, rel, from }) => {
	const { voice: _, ...given } = JSON.parse(from);
	let asked: Record<string, unknown> = given;
	for (let wait = 2000; ; wait *= 2) {
		const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ input: asked, voice: { languageCode: locale, name: voice }, audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 } })
		});
		const j = await res.json();
		if (j.audioContent) { await writeFile(join(OUT, rel), Buffer.from(j.audioContent, 'base64')); made[rel] = asked === given ? from : `${from} unaided`; return; }
		// a voice that will not take the sounds it was given says the name unaided
		if (res.status === 400 && 'customPronunciations' in asked) { asked = { text: given.text }; unaided.push(`${r.name} (${voice})`); continue; }
		// a per-minute quota, and the odd one-off failure: wait and try again
		if (wait < 64000) { await new Promise((ok) => setTimeout(ok, wait)); continue; }
		throw new Error(`${r.name}, ${voice}: ${JSON.stringify(j).slice(0, 200)}`);
	}
});
// recordings no country has any more (an earlier set of voices)
const wanted = new Set(jobs.map((j) => j.rel.slice('media/say/'.length)));
for (const f of await readdir(join(OUT, 'media', 'say'))) if (!wanted.has(f)) await rm(join(OUT, 'media', 'say', f));
for (const k of Object.keys(made)) if (!wanted.has(k.slice('media/say/'.length))) delete made[k];
await writeFile(madeFile, JSON.stringify(Object.fromEntries(Object.entries(made).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');
console.error(`${jobs.length} recordings (${missing.length} made now)`);
if (unaided.length) console.error(`said unaided, the voice would not take the sounds given: ${unaided.join('; ')}`);

if (process.argv.includes('--hear')) {
	const { decode, listen, transcribe } = await import(join(process.env.KNACK_APP ?? join(HERE, '../../../knack'), 'src/lib/engine/speech.ts'));
	const only = arg('--only', '');
	for (const r of rows) {
		if (only && !only.split(',').includes(r.name)) continue;
		const heard: string[] = [];
		for (const j of jobs.filter((x) => x.r === r)) heard.push((await transcribe(await listen(await decode(join(OUT, j.rel))))).join(''));
		console.log(`${r.name}\t${localeOf.get(r.id)}\t${heard.join('\t')}`);
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
	for (const [k, v] of Object.entries(r)) if (k !== COLUMN) { o[k] = v; if (k === 'name') o[COLUMN] = jobs.filter((j) => j.r.id === r.id).map((j) => j.rel); }
	return JSON.stringify(o);
}).join('\n') + '\n');
