"""
小さなモデルを、「写真を増やす」+「先生(BioCLIP 2)の確信の度合いを真似る(蒸留)」で学習する。

その1(train.py)からの変更点
  - 写真が約7倍（各種 約250枚）
  - 検証用は「撮影者ごと」に分ける（同じ人の似た写真が、訓練と検証にまたがらないように）
  - 損失 = 正解ラベルとのずれ + 先生の答え方とのずれ（蒸留）
  - モデルの種類・入力サイズ・蒸留の強さを、引数で変えて比べられる

使い方: python train2.py --arch mobilenet_v3_large --size 224 --alpha 0.7 [--final]
  --final を付けたときだけ、最終テスト（新しい写真399枚）を測る。ふだんは検証用だけで選ぶ。
注意: Windows では、複数の読み込みプロセスを使うため、実行部分は main() の中に置く（if __name__ == "__main__"）。
"""
import argparse
import json
import pathlib
import random
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms as T

ROOT = pathlib.Path(__file__).parent
NORM = T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])

import os
species = json.loads((ROOT / os.environ.get("SPECIES_FILE", "species75.json")).read_text(encoding="utf-8"))
classes = [s["scientific_name"] for s in species]
class_index = {n: i for i, n in enumerate(classes)}


class Photos(Dataset):
    def __init__(self, items, tf, size, tlogits=None):
        self.items, self.tf, self.size, self.tlogits = items, tf, size, tlogits

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        rel, y, _ = self.items[i]
        try:
            img = Image.open(ROOT / rel).convert("RGB")
        except Exception:
            img = Image.new("RGB", (self.size, self.size))
        if self.tlogits is not None and rel in self.tlogits:
            t = torch.from_numpy(self.tlogits[rel])
        else:
            t = torch.zeros(len(classes))
        return self.tf(img), y, t


def build_items(seed):
    """写真の一覧を作り、訓練用・検証用（撮影者ごとに分離）に分ける。"""
    teacher = np.load(ROOT / os.environ.get("TEACHER_FILE", "teacher_logits75.npz"))
    tlogits = {str(p).replace("\\", "/"): l for p, l in zip(teacher["paths"], teacher["logits"].astype(np.float32))}
    meta = json.loads((ROOT / "train_meta2.json").read_text(encoding="utf-8"))

    items, seen_obs = [], set()
    for rel in sorted(tlogits):
        folder, sp, fname = rel.split("/")[-3:]
        name, stem = sp.replace("_", " "), fname[:-4]
        obs = stem.split("_")[0]
        if folder == "images_train2":
            seen_obs.add((name, obs))
            items.append((rel, class_index[name], f"u-{meta.get(f'{name}/{stem}', {}).get('user')}"))
    for rel in sorted(tlogits):
        folder, sp, fname = rel.split("/")[-3:]
        name, obs = sp.replace("_", " "), fname[:-4].split("_")[0]
        if folder == "images_train" and (name, obs) not in seen_obs:
            items.append((rel, class_index[name], f"ok-{obs}"))  # 撮影者が分からない写真は、訓練側にだけ入れる

    rng = random.Random(seed)
    users = sorted({g for _, _, g in items if g.startswith("u-") and g != "u-None"})
    rng.shuffle(users)
    val_users = set(users[: int(len(users) * 0.12)])
    val_items = [it for it in items if it[2] in val_users]
    train_items = [it for it in items if it[2] not in val_users]
    test_items = []
    for n in classes:
        d = ROOT / "images_new" / n.replace(" ", "_")
        test_items += [(f"images_new/{n.replace(' ', '_')}/{p.name}", class_index[n], "t") for p in sorted(d.glob("*.jpg"))]
    return train_items, val_items, test_items, tlogits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arch", default="mobilenet_v3_large", choices=["mobilenet_v3_large", "efficientnet_b0"])
    ap.add_argument("--size", type=int, default=224)
    ap.add_argument("--alpha", type=float, default=0.7, help="蒸留の強さ（0=正解ラベルだけ）")
    ap.add_argument("--temp", type=float, default=2.0)
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--final", action="store_true")
    args = ap.parse_args()
    tag = os.environ.get("TAG_PREFIX", "") + f"{args.arch}_{args.size}_a{args.alpha}"
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = "cuda"

    train_items, val_items, test_items, tlogits = build_items(args.seed)
    print(f"訓練 {len(train_items)} / 検証 {len(val_items)}（撮影者ごとに分離）/ 最終テスト {len(test_items)}", flush=True)

    S = args.size
    train_tf = T.Compose([T.RandomResizedCrop(S, scale=(0.4, 1.0)), T.RandomHorizontalFlip(), T.ColorJitter(0.3, 0.3, 0.3, 0.05), T.ToTensor(), NORM])
    eval_tf = T.Compose([T.Resize(int(S * 256 / 224)), T.CenterCrop(S), T.ToTensor(), NORM])
    kw = dict(num_workers=6, persistent_workers=True, pin_memory=True)
    train_loader = DataLoader(Photos(train_items, train_tf, S, tlogits), batch_size=64, shuffle=True, drop_last=True, **kw)
    val_loader = DataLoader(Photos(val_items, eval_tf, S), batch_size=128, **kw)
    test_loader = DataLoader(Photos(test_items, eval_tf, S), batch_size=128, **kw)

    if args.arch == "mobilenet_v3_large":
        model = models.mobilenet_v3_large(weights=models.MobileNet_V3_Large_Weights.IMAGENET1K_V2)
        model.classifier[3] = nn.Linear(model.classifier[3].in_features, len(classes))
        head = model.classifier[3]
    else:
        model = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
        model.classifier[1] = nn.Linear(model.classifier[1].in_features, len(classes))
        head = model.classifier[1]
    model.to(device)
    scaler = torch.amp.GradScaler()

    def evaluate(loader):
        model.eval()
        top1 = top3 = n = 0
        confs, hits = [], []
        with torch.no_grad():
            for x, y, _ in loader:
                x, y = x.to(device), y.to(device)
                with torch.autocast("cuda", dtype=torch.float16):
                    p = model(x).float().softmax(-1)
                conf, pred = p.max(-1)
                top1 += (pred == y).sum().item()
                top3 += (p.topk(3, -1).indices == y[:, None]).any(-1).sum().item()
                n += len(y)
                confs += conf.tolist()
                hits += (pred == y).tolist()
        return top1 / n, top3 / n, n, confs, hits

    def loss_fn(logits, y, t_logits):
        ce = F.cross_entropy(logits, y, label_smoothing=0.05)
        if args.alpha <= 0:
            return ce
        T_ = args.temp
        kd = F.kl_div(F.log_softmax(logits / T_, -1), F.softmax(t_logits / T_, -1), reduction="batchmean") * T_ * T_
        return (1 - args.alpha) * ce + args.alpha * kd

    def run(epochs, lr, params, name):
        for p in model.parameters():
            p.requires_grad = False
        for p in params:
            p.requires_grad = True
        opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=lr, weight_decay=1e-4)
        sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=epochs * len(train_loader))
        best = (-1, None, 0)
        for ep in range(1, epochs + 1):
            model.train()
            t0, total = time.time(), 0.0
            for x, y, t in train_loader:
                x, y, t = x.to(device, non_blocking=True), y.to(device, non_blocking=True), t.to(device, non_blocking=True)
                opt.zero_grad(set_to_none=True)
                with torch.autocast("cuda", dtype=torch.float16):
                    out = model(x)
                loss = loss_fn(out.float(), y, t)
                scaler.scale(loss).backward()
                scaler.step(opt)
                scaler.update()
                sched.step()
                total += loss.item()
            v1, v3, _, _, _ = evaluate(val_loader)
            print(f"[{name}] {ep}/{epochs} 損失 {total / len(train_loader):.3f} | 検証 1位 {v1:.1%} 上位3 {v3:.1%} | {time.time() - t0:.0f}秒", flush=True)
            if v1 > best[0]:
                best = (v1, {k: v.detach().clone() for k, v in model.state_dict().items()}, v3)
        return best

    run(2, 2e-3, head.parameters(), "最後の層だけ")
    v1, state, v3 = run(args.epochs, args.lr * 0.4, model.parameters(), "全体を調整")
    model.load_state_dict(state)
    print(f"\n[{tag}] 検証で一番よかったモデル: 1位 {v1:.1%} / 上位3 {v3:.1%}", flush=True)
    res = {"tag": tag, "val_top1": v1, "val_top3": v3, "args": vars(args)}
    torch.save({"state": state, "classes": classes, "arch": args.arch, "size": S}, ROOT / f"model_{tag}.pt")
    if args.final:
        t1, t3, n, confs, hits = evaluate(test_loader)
        print(f"\n=== 最終テスト（新しい写真 {n}枚）=== 1位 {t1:.1%} / 上位3 {t3:.1%}")
        print("  比較: 前回の小さなモデル 1位 76.9% / 上位3 89.0%   BioCLIP 2(学習なし) 1位 96.0% / 上位3 98.5%")
        for th in (0.5, 0.7, 0.9):
            sel = [h for c, h in zip(confs, hits) if c >= th]
            if sel:
                print(f"  自信{th:.0%}以上だけ答える: 回答 {len(sel)}/{n}（{len(sel) / n:.0%}）, 正解率 {sum(sel) / len(sel):.1%}")
        res.update(test_top1=t1, test_top3=t3)
    (ROOT / f"result_{tag}.json").write_text(json.dumps(res, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
