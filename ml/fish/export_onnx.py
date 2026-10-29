"""75種のモデルを ONNX に変換し、変換の前後で答えが同じか確かめる。"""
import json, pathlib
import numpy as np, onnxruntime as ort, torch, torch.nn as nn
from PIL import Image
from torchvision import models, transforms as T
ROOT = pathlib.Path(__file__).parent
tag = "s75_efficientnet_b0_256_a0.7"
ck = torch.load(ROOT / f"model_{tag}.pt", map_location="cpu")
classes = ck["classes"]
m = models.efficientnet_b0(weights=None); m.classifier[1] = nn.Linear(m.classifier[1].in_features, len(classes))
m.load_state_dict(ck["state"]); m.eval()
class W(nn.Module):
    def __init__(self, m): super().__init__(); self.m = m
    def forward(self, x): return self.m(x).softmax(dim=-1)
w = W(m).eval(); out = ROOT / f"{tag}.onnx"
torch.onnx.export(w, torch.randn(1, 3, 256, 256), str(out), input_names=["input"], output_names=["probs"],
                  dynamic_axes={"input": {0: "batch"}, "probs": {0: "batch"}}, opset_version=17, dynamo=False)
print(f"保存: {out.name} {out.stat().st_size / 1048576:.1f} MB / {len(classes)}種")
sess = ort.InferenceSession(str(out), providers=["CPUExecutionProvider"])
tf = T.Compose([T.Resize(293), T.CenterCrop(256), T.ToTensor(), T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
files = []
for i, n in enumerate(classes):
    files += [(p, i) for p in sorted((ROOT / "images_new" / n.replace(" ", "_")).glob("*.jpg"))[:3]]
same = 0; md = 0.0
for p, i in files:
    x = tf(Image.open(p).convert("RGB")).unsqueeze(0)
    with torch.no_grad(): a = w(x).numpy()[0]
    b = sess.run(None, {"input": x.numpy()})[0][0]
    md = max(md, float(np.abs(a - b).max())); same += int(a.argmax() == b.argmax())
print(f"変換の確認 {len(files)}枚: 1位が一致 {same}/{len(files)} / 確率の最大のずれ {md:.1e}")
