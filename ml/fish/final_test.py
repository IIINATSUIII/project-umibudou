"""選んだモデルで、最終テスト（新しい写真399枚）を測る。最後に1回だけ実行する。"""
import json
import pathlib
import sys

import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT = pathlib.Path(__file__).parent
tag = sys.argv[1]
size = int(sys.argv[2])
import os
species = json.loads((ROOT / os.environ.get("SPECIES_FILE", "species75.json")).read_text(encoding="utf-8"))
ja = {s["scientific_name"]: s["ja_name"] for s in species}
classes = [s["scientific_name"] for s in species]
sess = ort.InferenceSession(str(ROOT / f"{tag}.onnx"), providers=["CPUExecutionProvider"])
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def prep(path):
    """学習のときと同じ前処理: 短い辺を size*256/224 に、中央を size で切り出す。"""
    img = Image.open(path).convert("RGB")
    short = int(size * 256 / 224)
    w, h = img.size
    scale = short / min(w, h)
    img = img.resize((max(short, round(w * scale)), max(short, round(h * scale))), Image.BILINEAR)
    w, h = img.size
    left, top = (w - size) // 2, (h - size) // 2
    img = img.crop((left, top, left + size, top + size))
    a = (np.asarray(img, dtype=np.float32) / 255.0 - MEAN) / STD
    return a.transpose(2, 0, 1)[None].astype(np.float32)


top1 = top3 = n = 0
confs, hits, wrong = [], [], []
for i, name in enumerate(classes):
    for p in sorted((ROOT / "images_new" / name.replace(" ", "_")).glob("*.jpg")):
        probs = sess.run(None, {"input": prep(p)})[0][0]
        order = np.argsort(-probs)
        ok = order[0] == i
        top1 += int(ok)
        top3 += int(i in order[:3])
        n += 1
        confs.append(float(probs[order[0]]))
        hits.append(bool(ok))
        if not ok:
            wrong.append((ja[name], ja[classes[order[0]]]))
print(f"[{tag}] 最終テスト（新しい写真 {n}枚）: 1位 {top1 / n:.1%} / 上位3 {top3 / n:.1%}")
print("  比較: 前回の小さなモデル 1位 76.9% / 上位3 89.0%   BioCLIP 2(学習なし) 1位 96.0% / 上位3 98.5%")
for th in (0.5, 0.7, 0.9):
    sel = [h for c, h in zip(confs, hits) if c >= th]
    if sel:
        print(f"  自信{th:.0%}以上だけ答える: 回答 {len(sel)}/{n}（{len(sel) / n:.0%}）, 正解率 {sum(sel) / len(sel):.1%}")
from collections import Counter
print("  よく間違える組み合わせ(正解 → 予測):", ", ".join(f"{a}→{b} {c}回" for (a, b), c in Counter(wrong).most_common(5)))
