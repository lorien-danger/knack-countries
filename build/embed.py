"""
Embed the flags with self-supervised vision models and write the "flag ..." embedding columns.
  npx tsx render-flags.ts /tmp/flags                      (draws the flags, in rows.jsonl order)
  python embed.py /tmp/flags [dinov2] [ijepa] [clip]      (needs numpy, torch, transformers, pillow)

For each model, writes the full-size vectors to build/flag-<key>-full.npy (not a column) and the 64-number version
to ../flag-<key>.npy, and adds the column to ../columns.json. The 64-number version is made as the Knack app does
(src/lib/engine/embed.ts, reduce): unit-length vectors, centre, PCA to 64 numbers, scale so the mean squared
norm is 1. "clip" is only a check: it redoes the existing "flag look" from these PNGs and compares (writes nothing).

The whole flag is shown to the model, squashed to 224x224 (no centre crop, which for a 4:3 flag would cut off its
left and right thirds under DINOv2's default 256/224 preprocessing). DINOv2: the class token (final layer norm).
I-JEPA has no class token: the mean of its patch tokens.
"""
import json, sys
from pathlib import Path
import numpy as np, torch
from PIL import Image
from transformers import AutoModel, AutoImageProcessor

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MODELS = {  # key: (column name, model, mean/std)
    'dinov2': ('flag dinov2', 'facebook/dinov2-base', ([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])),
    'ijepa': ('flag ijepa', 'facebook/ijepa_vith14_1k', ([0.5] * 3, [0.5] * 3)),
}

def reduce(v, dims=64):
    u = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)
    z = (u - u.mean(0)).astype(np.float64)
    _, _, vt = np.linalg.svd(z, full_matrices=False)
    p = z @ vt[:dims].T
    return (p / np.sqrt((p ** 2).sum(1).mean())).astype(np.float32)

def load(folder, ids, mean, std):
    ims = [np.asarray(Image.open(Path(folder) / f'{i}.png').convert('RGB').resize((224, 224), Image.BICUBIC), dtype=np.float32) / 255 for i in ids]
    x = (np.stack(ims) - np.array(mean, dtype=np.float32)) / np.array(std, dtype=np.float32)
    return torch.from_numpy(x).permute(0, 3, 1, 2)

@torch.no_grad()
def run(key, folder, ids):
    _, name, (mean, std) = MODELS[key]
    model = AutoModel.from_pretrained(name).eval()
    out = []
    for s in range(0, len(ids), 16):
        o = model(pixel_values=load(folder, ids[s:s + 16], mean, std))
        out.append((o.pooler_output if key == 'dinov2' else o.last_hidden_state.mean(1)).numpy())
    return np.concatenate(out)

@torch.no_grad()
def clip_check(folder, ids):
    from transformers import CLIPModel, CLIPProcessor
    m = CLIPModel.from_pretrained('openai/clip-vit-base-patch32').eval(); p = CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32')
    ims = [Image.open(Path(folder) / f'{i}.png').convert('RGB') for i in ids]
    v = np.concatenate([m.visual_projection(m.vision_model(**p(images=ims[s:s + 16], return_tensors='pt')).pooler_output).numpy() for s in range(0, len(ims), 16)])
    mine, theirs = reduce(v), np.load(ROOT / 'flag-look.npy')
    d = lambda a: ((a[:, None] - a[None]) ** 2).sum(-1)
    iu = np.triu_indices(len(ids), 1)
    print('clip check: correlation of pairwise distances with existing flag-look:', np.corrcoef(d(mine)[iu], d(theirs)[iu])[0, 1])
    nn = lambda a: np.argsort(d(a) + np.eye(len(a)) * 1e9, 1)[:, 0]
    print('clip check: same nearest flag for', (nn(mine) == nn(theirs)).mean())

if __name__ == '__main__':
    folder, keys = sys.argv[1], sys.argv[2:] or list(MODELS)
    ids = [json.loads(l)['id'] for l in open(ROOT / 'rows.jsonl') if l.strip()]
    meta = json.load(open(ROOT / 'columns.json'))
    for key in keys:
        if key == 'clip': clip_check(folder, ids); continue
        col, name, _ = MODELS[key]
        full = run(key, folder, ids)
        np.save(HERE / f'flag-{key}-full.npy', full.astype(np.float32))
        np.save(ROOT / f'flag-{key}.npy', reduce(full))
        meta['columns'] = [c for c in meta['columns'] if c['name'] != col] + [
            {'name': col, 'type': 'embedding', 'file': f'flag-{key}.npy', 'of': 'flag', 'model': name}]
        with open(ROOT / 'columns.json', 'w') as f: f.write(json.dumps(meta, indent=1, ensure_ascii=False) + '\n')
        print(col, full.shape, '->', f'flag-{key}.npy', flush=True)
