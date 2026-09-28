#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор демо-данных в формате, который отдаёт scripts/fetch.py.

Нужен, чтобы посмотреть и согласовать вид дашборда до подключения токена.
Запуск: python3 scripts/make_demo.py
"""

import json
import os
import random
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")

random.seed(20260928)

SITE = "rusklimat.ru"
COMPETITORS = ["daichi.ru", "ballu.ru", "electrolux.ru"]
BASES = ["msk", "gru"]

PROFILE = {
    # домен: (видимость, it10, it3, трафик, страниц в индексе, запросов в топ-10)
    "rusklimat.ru": (48200, 9600, 2100, 41500, 248000, 15600),
    "daichi.ru": (39700, 8100, 1650, 35200, 196000, 12800),
    "ballu.ru": (36400, 7400, 1420, 31800, 173000, 11400),
    "electrolux.ru": (27400, 5200, 980, 23600, 121000, 8600),
}

WORDS = [
    "кондиционер купить", "сплит система цена", "мобильный кондиционер",
    "кондиционер с установкой", "вентиляция для дома", "приточная вентиляция",
    "осушитель воздуха", "увлажнитель воздуха купить", "тепловентилятор",
    "инфракрасный обогреватель", "конвектор электрический", "тепловая завеса",
    "бризер для квартиры", "рекуператор воздуха", "чиллер для кондиционера",
    "мульти сплит система", "канальный кондиционер", "кассетный кондиционер",
    "кондиционер инверторный", "обслуживание кондиционеров",
]


def months(count=12):
    now = datetime.now(timezone.utc)
    result = []
    for shift in range(count - 1, -1, -1):
        total = now.year * 12 + (now.month - 1) - shift
        result.append(f"{total // 12}.{total % 12 + 1:02d}")
    return result


def build_domain(domain, base, index):
    vis, it10, it3, traf, pages, topkeys = PROFILE[domain]
    factor = 1.0 if base == "msk" else 0.42
    drift = 1.0 + index * 0.012

    summary = {
        "domain": domain,
        "id": 29000000 + index,
        "it1": int(vis * 2.9 * factor),
        "it3": int(it3 * factor * drift),
        "it5": int(it3 * 1.6 * factor),
        "it10": int(it10 * factor * drift),
        "it50": int(it10 * 3.4 * factor),
        "vis": int(vis * factor * drift),
        "topvis": random.randint(90, 180),
        "topkeys": int(topkeys * factor),
        "pagesinindex": pages,
        "adtraf": int(traf * 0.08),
        "adscnt": random.randint(400, 1800),
        "adkeyscnt": random.randint(9000, 48000),
        "adcost": random.randint(400000, 2500000),
        "adcost_max": random.randint(2500000, 6000000),
        "context_ads": random.randint(200, 900),
        "context_adkeys": random.randint(3000, 12000),
        "context_concs": random.randint(40, 120),
        "delta": {
            "it1": random.randint(-1200, 1800),
            "it3": random.randint(-400, 600),
            "it5": random.randint(-600, 900),
            "it10": random.randint(-900, 1400),
            "it50": random.randint(-2000, 2600),
            "vis": random.randint(-1800, 2400),
            "topvis": random.randint(-8, 12),
            "pagesinindex": random.randint(-900, 1500),
            "adtraf": random.randint(-700, 900),
        },
    }

    months_list = months(12)
    history = []
    for i, period in enumerate(months_list):
        wave = 1.0 + (i - 6) * 0.018 + random.uniform(-0.03, 0.03)
        history.append({
            "period": period,
            "it1": int(summary["it1"] * wave),
            "it3": int(summary["it3"] * wave),
            "it5": int(summary["it5"] * wave),
            "it10": int(summary["it10"] * wave),
            "it50": int(summary["it50"] * wave),
            "vis": int(summary["vis"] * wave),
            "pages": int(pages * (1 + i * 0.01)),
            "ads": int(summary["adscnt"] * wave),
            "ai": random.randint(40, 320),
        })

    rows = []
    for word in WORDS:
        rows.append({
            "word": word,
            "url": random.choice(["/catalog/", "/product/", "/solutions/"]) + f"{random.randint(100,999)}/",
            "ws": random.randint(2000, 90000),
            "wsk": random.randint(500, 40000),
            "pos": random.randint(1, 45),
            "delta": random.randint(-9, 9),
            "avbid": random.randint(3, 90),
            "serpf": "24.09.2026",
        })
    rows.sort(key=lambda r: r["wsk"], reverse=True)

    return {
        "summary": summary,
        "history": history,
        "keywords": {"total": random.randint(9000, 46000), "rows": rows[:50]},
    }


def build_keywords_recent(domains_map):
    merged = {}
    for domain, payload in domains_map.items():
        for row in payload["keywords"]["rows"]:
            entry = merged.setdefault(row["word"], {"word": row["word"], "ws": 0, "wsk": 0, "pos": {}})
            entry["ws"] = max(entry["ws"], row["ws"])
            entry["wsk"] = max(entry["wsk"], row["wsk"])
            entry["pos"][domain] = {"pos": row["pos"], "delta": row["delta"], "url": row["url"]}
    rows = [v for v in merged.values() if SITE in v["pos"]]
    rows.sort(key=lambda r: r["wsk"], reverse=True)
    return rows[:20]


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc)
    store = {
        "site": SITE,
        "generated_at": stamp.isoformat(timespec="seconds"),
        "generated_at_msk": (stamp + timedelta(hours=3)).strftime("%d.%m.%Y %H:%M"),
        "previous_at": (stamp - timedelta(hours=3)).isoformat(timespec="seconds"),
        "previous_at_msk": (stamp - timedelta(hours=3) + timedelta(hours=3)).strftime("%d.%m.%Y %H:%M"),
        "bases": BASES,
        "competitors": COMPETITORS,
        "domains": {},
        "errors": [],
        "demo": True,
    }
    domains = [SITE] + COMPETITORS
    for base in BASES:
        store["domains"][base] = {}
        for i, domain in enumerate(domains):
            store["domains"][base][domain] = build_domain(domain, base, i)

    store["keywords_recent"] = build_keywords_recent(store["domains"][BASES[0]])

    path = os.path.join(DATA_DIR, "latest.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(store, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"Демо-данные записаны: {path} ({os.path.getsize(path)/1024:.0f} КБ)")


if __name__ == "__main__":
    main()
