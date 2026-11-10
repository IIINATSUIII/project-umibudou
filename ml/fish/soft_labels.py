"""
先生(BioCLIP 2)に、学習用の写真ぜんぶへ「50種それぞれの近さ(ロジット)」を付けてもらう。
小さなモデルは、正解ラベルだけでなく、この「確信の度合い」も真似して学習する（蒸留）。
出力: teacher_logits.npz（paths: 写真のパス、logits: [N, 50]）
"""
import json
import pathlib

import numpy as np
import open_clip
import torch
from PIL import Image

ROOT = pathlib.Path(__file__).parent
import os
species = json.loads((ROOT / os.environ.get("SPECIES_FILE", "species75.json")).read_text(encoding="utf-8"))
names = [s["scientific_name"] for s in species]

paths = []
for folder in ("images_train2", "images_train"):
    for n in names:
        paths += sorted((ROOT / folder / n.replace(" ", "_")).glob("*.jpg"))
print("写真", len(paths), "枚")

device = "cuda"
model, _, preprocess = open_clip.create_model_and_transforms("hf-hub:imageomics/bioclip-2")
tokenizer = open_clip.get_tokenizer("hf-hub:imageomics/bioclip-2")
model = model.to(device).eval().half()
with torch.no_grad():
    text = model.encode_text(tokenizer([f"a photo of {n}." for n in names]).to(device))
    text = text / text.norm(dim=-1, keepdim=True)


class DS(torch.utils.data.Dataset):
    def __len__(self):
        return len(paths)

    def __getitem__(self, i):
        try:
            img = Image.open(paths[i]).convert("RGB")
        except Exception:
            img = Image.new("RGB", (224, 224))
        return preprocess(img)




def main():
    loader = torch.utils.data.DataLoader(DS(), batch_size=64, num_workers=0)
    out = []
    with torch.no_grad():
        for k, x in enumerate(loader):
            f = model.encode_image(x.to(device).half())
            f = f / f.norm(dim=-1, keepdim=True)
            out.append((100.0 * f @ text.T).float().cpu().numpy())
            if k % 20 == 0:
                print(f"  {min((k + 1) * 64, len(paths))}/{len(paths)}", flush=True)
    logits = np.concatenate(out).astype(np.float16)
    np.savez(ROOT / os.environ.get("TEACHER_FILE", "teacher_logits75.npz"), paths=np.array([str(p.relative_to(ROOT)) for p in paths]), logits=logits)
    print("保存: teacher_logits.npz", logits.shape)


if __name__ == "__main__":
    main()
