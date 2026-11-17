# Countries

198 countries (sovereign states plus Kosovo, Palestine, Taiwan and Western Sahara): name, the name said aloud,
flag, where it is (its shape), region, population and size, plus two embeddings: what the flag looks like (DINOv2, a self-supervised vision model that goes by layout,
shapes and colours) and how the name sounds (a ByT5 pronunciation model). A dataset for [Knack](https://github.com/lorien-danger/knack): add it by this
repo's link.

Sources: shapes and population estimates (mostly 2019) from [Natural Earth](https://www.naturalearthdata.com/)
1:50m admin-0 countries (public domain); sizes from [mledoze/countries](https://github.com/mledoze/countries)
(ODbL); flags linked to [flag-icons](https://github.com/lipis/flag-icons) 7.6.0 (MIT) on jsDelivr; the names
are said by Google Cloud Text-to-Speech voices (see below).

Because it includes ODbL data, this database is made available under the
[Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).

## Columns

| column | what it is |
| --- | --- |
| name, flag, location, region, population, size (km²) | the facts (see above) |
| spoken name | the English name said in the country's accent, or the nearest there is, by four voices (`media/say/<id>.<speaker>.mp3`); each time it is played, one of them. It is the name in another form (`"same": "name"`) |
| flag look | embedding of the flag, DINOv2 (`facebook/dinov2-base`), 64 numbers: `flag-look.npy` |
| name sound | embedding of the name, ByT5 pronunciation model, 64 numbers: `name-sound.npy` |

Embeddings are PCA-reduced to 64 numbers and scaled so a typical item is about 1 from the centre. The full-size
DINOv2 vectors (768 numbers) are in `build/flag-look-full.npy`.

## The spoken names

The English name of each country, read in the accent of the country. `build/say.ts` makes them with Google Cloud's
Chirp 3 HD voices: the voices of the country's own language where Google has them (a German voice says "Germany"),
and otherwise the nearest there are, which `build/voices.tsv` lists for all 198. Many are only near: the French
voices read the names of French-speaking Africa, one Arabic voice set reads every Arab country, the Swahili voices
read most of Africa south of the Sahara that is not French- or Portuguese-speaking, and Portugal is read by
Brazilian voices. Each name has four recordings, two women and two men, and the speakers change from one country to
the next.

Voices that are English (Australian for the Pacific, British, American, Indian) are given each name's sounds from
`build/said.tsv`, since unaided they read some names wrongly (Grenada like Granada, Kiribati as it is spelled).
Voices of other languages read the English spelling as their language would, which is the accent wanted, and
sometimes the country's own word for itself (a French voice says France the French way).

The recordings were checked by machine, not by ear: a phoneme recogniser wrote down what it heard in each.

    cd build && npx tsx say.ts --env <a .env with GC_API_KEY>     # add --hear to print what the recogniser hears

## Building it

`build/` makes the dataset. `build.ts` writes the full version to `local/` (not in this repo: it holds the flags as
PNG files, so it works offline), `embed.py` adds how the flags look and the Knack app's `npm run describe` adds how the names sound, `say.ts` adds the names said aloud, and `publish.ts`
turns it into the files at the top of this repo, with the flags as links.

    cd build && npm install
    npx tsx build.ts
    npx tsx publish.ts

`flag look` is made by `build/embed.py` (Python with numpy, torch, transformers and pillow; about a minute):

    cd build && npx tsx render-flags.ts /tmp/flags     # the flags as 640x480 PNG, in rows.jsonl order
    python embed.py /tmp/flags ../local                # writes local/flag-look.npy and its column
