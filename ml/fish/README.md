# おさかな図鑑AI: モデルの作り方

「おさかな図鑑」（`/line-menu/fish`）の魚判定モデルを作ったときのスクリプト。
モデルの仕組み・精度・**学習データのライセンス（非商用）**は、[docs/10_おさかな図鑑AI.md](../../docs/10_おさかな図鑑AI.md) を先に読むこと。

アプリ本体（Next.js）の実行には、このフォルダは**不要**。モデルを作り直したいときだけ使う。

## 準備

- Python 3.13、PyTorch（CUDA 対応の GPU を推奨）、`torchvision`、`open_clip_torch`、`onnx`、`onnxruntime`、`pillow`、`requests`、`numpy`
- 先生モデル BioCLIP 2 は、初回に Hugging Face から自動でダウンロードされる（約1.7GB）
- 作業は、**このフォルダとは別の場所**（写真と中間ファイルが大きいため）にコピーして行う。Windows では、データの読み込みに複数プロセスを使うので、各スクリプトは `if __name__ == "__main__":` の中で動く形になっている

## 手順

```
# 1) 学習用の写真（2025年6月以前、各種 約250枚、同じ撮影者は最大6枚）。続きから再開できる
python collect_train.py

# 2) 最終テスト用の写真（2025年7月以降、各種 8枚）。学習用と日付で分けてあり、混ざらない
python collect_test.py 8

# 3) 先生（BioCLIP 2）が、全写真に75種の近さを付ける（学習用 約2万枚で、10〜15分）
python soft_labels.py

# 4) 学習（EfficientNet-B0、先生を真似る蒸留つき、約25分）。検証用は撮影者ごとに分ける
python train2.py --arch efficientnet_b0 --size 256 --alpha 0.7 --epochs 15

# 5) ONNX に変換して、変換の前後で答えが一致することを確かめる
python export_onnx.py

# 6) 最終テスト（モデルを選び終えたあとに、1回だけ）
python final_test.py s75_efficientnet_b0_256_a0.7 256
```

できた `.onnx` を、`public/models/fish/` に、**新しいバージョン名**（例: `fish-s75-v2.onnx`）で置き、`src/lib/fish/classify.ts` の `MODEL_URL` を変える（ブラウザが1年間キャッシュするため）。
種のリストを変えたときは、`species75.json` と `src/lib/fish/speciesData.json` の並び（番号）を、モデルの出力の並びと必ず一致させること。

## 注意

- iNaturalist の API は、**連絡先つきの名前を付けて、1秒に1回程度の控えめな間隔**で呼ぶこと（スクリプトは、そうなっている）。
- 集めた写真の撮影者・ライセンスは、`train_meta2.json` などに記録される。写真は、このリポジトリに入れない。
- 学習用の写真には、非商用限定（CC BY-NC 系）と、改変禁止（ND）のものが含まれる。**営利目的に使うなら、ライセンスが明確な写真だけで学習し直す**こと。
