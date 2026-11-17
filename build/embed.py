"""
Embed the flags with DINOv2, a self-supervised vision model that goes by layout, shapes and colours, and write the
"flag look" embedding column.
  npx tsx render-flags.ts /tmp/flags       (draws the flags, in rows.jsonl order)
  python embed.py /tmp/flags [folder]      (needs numpy, torch, transformers, pillow; folder defaults to ..)

Writes the full-size vectors to build/flag-look-full.npy (not a column) and the 64-number version to
<folder>/flag-look.npy, and sets the column in <folder>/columns.json. The 64-number version is made as the Knack app
does (src/lib/engine/embed.ts, reduce): unit-length vectors, centre, PCA to 64 numbers, scale so the mean squared
norm is 1.

The whole flag is shown to the model, squashed to 224x224 (no centre crop, which for a 4:3 flag would cut off its
left and right thirds under DINOv2's default 256/224 preprocessing). The class token (final layer norm) is used.
"""
import json, sys
from pathlib import Path
import numpy as np, torch
from PIL import Image
from transformers import AutoModel

HERE = Path(__file__).resolve().parent
COLUMN, FILE, MODEL = 'flag look', 'flag-look.npy', 'facebook/dinov2-base'
MEAN, STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]

def reduce(v, dims=64):
    u = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)
    z = (u - u.mean(0)).astype(np.float64)
    _, _, vt = np.linalg.svd(z, full_matrices=False)
    p = z @ vt[:dims].T
    return (p / np.sqrt((p ** 2).sum(1).mean())).astype(np.float32)

def load(folder, ids):
    ims = [np.asarray(Image.open(Path(folder) / f'{i}.png').convert('RGB').resize((224, 224), Image.BICUBIC), dtype=np.float32) / 255 for i in ids]
    x = (np.stack(ims) - np.array(MEAN, dtype=np.float32)) / np.array(STD, dtype=np.float32)
    return torch.from_numpy(x).permute(0, 3, 1, 2)

@torch.no_grad()
def run(folder, ids):
    model = AutoModel.from_pretrained(MODEL).eval()
    return np.concatenate([model(pixel_values=load(folder, ids[s:s + 16])).pooler_output.numpy() for s in range(0, len(ids), 16)])

if __name__ == '__main__':
    folder = sys.argv[1]
    root = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE.parent
    ids = [json.loads(l)['id'] for l in open(root / 'rows.jsonl') if l.strip()]
    meta = json.load(open(root / 'columns.json'))
    full = run(folder, ids)
    np.save(HERE / 'flag-look-full.npy', full.astype(np.float32))
    np.save(root / FILE, reduce(full))
    OF = 'flag'
    # what makes two of the column's values alike is written on the column itself ("near"), never as a column of
    # its own
    by = COLUMN[len(OF) + 1:] if COLUMN.startswith(OF + ' ') else COLUMN
    near = {'file': FILE, 'by': by, 'model': MODEL}
    meta['columns'] = [c for c in meta['columns'] if c['name'] != COLUMN]
    for c in meta['columns']:
        if c['name'] == OF:
            others = [x for x in ([c['near']] if isinstance(c.get('near'), dict) else c.get('near', [])) if x.get('file') != FILE]
            c['near'] = [*others, near] if others else near
    with open(root / 'columns.json', 'w') as f: f.write(json.dumps(meta, indent=1, ensure_ascii=False) + '\n')
    print(COLUMN, full.shape, '->', FILE, flush=True)
