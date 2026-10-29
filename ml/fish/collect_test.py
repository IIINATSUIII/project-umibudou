"""
iNaturalist の公開 API から、沖縄で記録の多い魚の上位50種と、各種のテスト用写真を集める。
- 読み取りだけ。連絡先つきの名前を付け、1秒に1回程度の控えめな間隔で呼ぶ。
- 写真は、許諾（license_code）がある観察の、中サイズの画像だけを使う（全権利留保は使わない）。
- 結果: species.json（種のリスト）、images/<学名>/*.jpg（各種の写真）、images_meta.json（撮影者・許諾・出典）
"""
import json
import os
import pathlib
import sys
import time

import requests

UA = {"User-Agent": "okidive-fish-research/0.1 (school project; contact: hkin0330@gmail.com)"}
API = "https://api.inaturalist.org/v1"
PLACE_OKINAWA = 13082
TAXON_FISH = 47178  # Actinopterygii（条鰭綱）
TOP_N = 50
PER_SPECIES = int(sys.argv[1]) if len(sys.argv) > 1 else 12
ROOT = pathlib.Path(__file__).parent
IMG = ROOT / "images_new"
IMG.mkdir(exist_ok=True)


def get(path, **params):
    time.sleep(1.1)
    r = requests.get(f"{API}{path}", params=params, headers=UA, timeout=60)
    r.raise_for_status()
    return r.json()


def main():
    species_file = ROOT / os.environ.get("SPECIES_FILE", "species75.json")
    if species_file.exists():
        species = json.loads(species_file.read_text(encoding="utf-8"))
    else:
        j = get(
            "/observations/species_counts",
            place_id=PLACE_OKINAWA, taxon_id=TAXON_FISH, quality_grade="research",
            locale="ja", per_page=TOP_N,
        )
        species = [
            {
                "taxon_id": r["taxon"]["id"],
                "scientific_name": r["taxon"]["name"],
                "ja_name": r["taxon"].get("preferred_common_name"),
                "observations": r["count"],
            }
            for r in j["results"]
        ]
        species_file.write_text(json.dumps(species, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"種: {len(species)}")

    meta_file = ROOT / "images_new_meta.json"
    meta = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.exists() else {}
    for i, sp in enumerate(species, 1):
        name = sp["scientific_name"]
        folder = IMG / name.replace(" ", "_")
        folder.mkdir(exist_ok=True)
        have = len(list(folder.glob("*.jpg")))
        if have >= PER_SPECIES:
            continue
        # 許諾のある写真だけ（license=any は、何らかの許諾があるもの）。1観察につき1枚目を使う
        j = get(
            "/observations",
            place_id=PLACE_OKINAWA, taxon_id=sp["taxon_id"], quality_grade="research",
            photos="true", license="any", photo_license="any", per_page=min(60, PER_SPECIES * 3),
            d1="2025-07-01", order_by="observed_on", order="desc", locale="ja",
        )
        got = have
        for ob in j["results"]:
            if got >= PER_SPECIES:
                break
            for ph in ob.get("photos", [])[:1]:
                lic = ph.get("license_code")
                if not lic:
                    continue
                url = ph["url"].replace("square", "medium")
                dest = folder / f"{ob['id']}.jpg"
                if dest.exists():
                    got += 1
                    continue
                try:
                    time.sleep(0.4)
                    data = requests.get(url, headers=UA, timeout=60)
                    data.raise_for_status()
                    dest.write_bytes(data.content)
                except Exception as e:  # 取れなかった写真は飛ばす
                    print("  skip", url, e)
                    continue
                meta[f"{name}/{ob['id']}"] = {
                    "license": lic,
                    "attribution": ph.get("attribution"),
                    "observation": f"https://www.inaturalist.org/observations/{ob['id']}",
                }
                got += 1
        print(f"[{i}/{len(species)}] {sp['ja_name']} ({name}) 写真 {got}枚")
        meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
