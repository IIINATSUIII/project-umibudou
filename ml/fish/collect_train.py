"""
学習用の写真を集める・その2（地域を広げて、各種 約250枚）。
- 沖縄に限らず、同じ種の研究グレードの写真を、世界から集める（同じ魚なので、見た目は同じ）。
- 1観察につき最大2枚、同じ人は1種につき最大6枚。撮影者のIDを記録する（検証用の分け方に使う）。
（以下は、その1の説明）
- 2025-06-30 以前に撮られた、沖縄の研究グレードの観察だけ（評価用は 2025-07-01 以降なので、混ざらない）。
- 同じ人（user）の写真は、1種につき最大4枚まで（似た写真ばかりになるのを防ぐ）。
- 許諾のある写真だけ。撮影者・許諾・出典を train_meta.json に残す。
- 読み取り用の公開APIを、1秒に1回程度の控えめな間隔で呼ぶ。写真の取得は少し並列にする。
"""
import json
import pathlib
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import requests

UA = {"User-Agent": "okidive-fish-research/0.1 (school project; contact: hkin0330@gmail.com)"}
API = "https://api.inaturalist.org/v1"
PLACE_OKINAWA = 13082
PER_SPECIES = 250
MAX_PER_USER = 6
ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "images_train2"
OUT.mkdir(exist_ok=True)
import os
species = json.loads((ROOT / os.environ.get("SPECIES_FILE", "species75.json")).read_text(encoding="utf-8"))
meta_file = ROOT / "train_meta2.json"
meta = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.exists() else {}


def api(path, **params):
    # 一時的な接続エラーや混雑（429/5xx）は、間をあけて数回やり直す
    for attempt in range(6):
        time.sleep(1.1 + attempt * 5)
        try:
            r = requests.get(f"{API}{path}", params=params, headers=UA, timeout=60)
            if r.status_code in (429, 500, 502, 503, 504):
                continue
            r.raise_for_status()
            return r.json()
        except requests.exceptions.ConnectionError:
            continue
    raise RuntimeError("iNaturalist API に接続できませんでした")


def download(job):
    url, dest = job
    if dest.exists():
        return True
    try:
        time.sleep(0.2)
        r = requests.get(url, headers=UA, timeout=60)
        r.raise_for_status()
        dest.write_bytes(r.content)
        return True
    except Exception:
        return False


for i, sp in enumerate(species, 1):
    name = sp["scientific_name"]
    folder = OUT / name.replace(" ", "_")
    folder.mkdir(exist_ok=True)
    have = len(list(folder.glob("*.jpg")))
    if have >= PER_SPECIES * 0.8:
        continue
    picks, per_user = [], Counter()
    for page in (1, 2, 3, 4, 5):
        j = api(
            "/observations",
            taxon_id=sp["taxon_id"], quality_grade="research",
            photos="true", license="any", photo_license="any", d2="2025-06-30",
            per_page=200, page=page, order_by="id", order="desc", locale="ja",
        )
        for ob in j["results"]:
            user = (ob.get("user") or {}).get("id")
            for ph in (ob.get("photos") or [])[:2]:
                if not ph.get("license_code") or per_user[user] >= MAX_PER_USER:
                    continue
                per_user[user] += 1
                picks.append((ob, ph, user))
        if len(picks) >= PER_SPECIES * 1.3 or len(j["results"]) < 200:
            break
    picks = picks[:PER_SPECIES]
    jobs = [(ph["url"].replace("square", "medium"), folder / f"{ob['id']}_{ph['id']}.jpg") for ob, ph, _ in picks]
    with ThreadPoolExecutor(max_workers=4) as pool:
        ok = list(pool.map(download, jobs))
    for (ob, ph, user), good in zip(picks, ok):
        if good:
            meta[f"{name}/{ob['id']}_{ph['id']}"] = {
                "user": user,
                "license": ph.get("license_code"),
                "attribution": ph.get("attribution"),
                "observation": f"https://www.inaturalist.org/observations/{ob['id']}",
            }
    meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[{i}/{len(species)}] {sp['ja_name']} ({name}) 写真 {sum(ok)}枚 / 候補 {len(picks)}", flush=True)
print("完了")
