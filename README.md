# Countries

198 countries (sovereign states plus Kosovo, Palestine, Taiwan and Western Sahara): name, flag, where it is
(its shape), region, population and size, plus four embeddings: what the flag looks like (CLIP, DINOv2 and I-JEPA; the last two are self-supervised
vision models, which go by layout, shapes and colours rather than meaning) and how the name sounds (a ByT5
pronunciation model). A dataset for [Knack](https://github.com/lorien-danger/knack): add it by this
repo's link.

Sources: shapes and population estimates (mostly 2019) from [Natural Earth](https://www.naturalearthdata.com/)
1:50m admin-0 countries (public domain); sizes from [mledoze/countries](https://github.com/mledoze/countries)
(ODbL); flags linked to [flag-icons](https://github.com/lipis/flag-icons) 7.6.0 (MIT) on jsDelivr.

Because it includes ODbL data, this database is made available under the
[Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).

## Columns

| column | what it is |
| --- | --- |
| name, flag, location, region, population, size (km²) | the facts (see above) |
| flag look | embedding of the flag, CLIP (`Xenova/clip-vit-base-patch32`), 64 numbers: `flag-look.npy` |
| flag dinov2 | embedding of the flag, DINOv2 (`facebook/dinov2-base`), 64 numbers: `flag-dinov2.npy` |
| flag ijepa | embedding of the flag, I-JEPA (`facebook/ijepa_vith14_1k`), 64 numbers: `flag-ijepa.npy` |
| name sound | embedding of the name, ByT5 pronunciation model, 64 numbers: `name-sound.npy` |

Embeddings are PCA-reduced to 64 numbers and scaled so a typical item is about 1 from the centre. The full-size
DINOv2 (768) and I-JEPA (1280) vectors are in `build/flag-dinov2-full.npy` and `build/flag-ijepa-full.npy`.

## Building it

`build/` makes the dataset. `build.ts` writes the full version to `local/` (not in this repo: it holds the flags as
PNG files, so it works offline), the Knack app's `npm run describe` adds the two embeddings to it, and `publish.ts`
turns it into the files at the top of this repo, with the flags as links.

    cd build && npm install
    npx tsx build.ts
    npx tsx publish.ts

The DINOv2 and I-JEPA flag columns are made by `build/embed.py` (Python with numpy, torch, transformers and
pillow; I-JEPA takes about 15 minutes on two CPU cores):

    cd build && npx tsx render-flags.ts /tmp/flags     # the flags as 640x480 PNG, in rows.jsonl order
    python embed.py /tmp/flags dinov2 ijepa            # writes ../flag-*.npy, build/flag-*-full.npy, columns.json
