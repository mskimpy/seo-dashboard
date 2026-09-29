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
CONFIG_PATH = os.path.join(ROOT, "config.json")

random.seed(20260928)

# Условная «сила» домена: (видимость, запросов в топ-10, трафик, страниц в индексе)
PROFILE = {
    "rusklimat.ru": (48200, 9600, 41500, 248000),
    "dns-shop.ru": (214000, 52000, 186000, 1240000),
    "vseinstrumenti.ru": (168000, 41000, 148000, 980000),
    "mvideo.ru": (141000, 35000, 132000, 760000),
    "lemanapro.ru": (96500, 24000, 88000, 430000),
    "lunda.ru": (41300, 8400, 36800, 205000),
    "santech.ru": (33700, 6900, 29400, 168000),
    "mircli.ru": (26900, 5400, 23100, 121000),
    "master-water.ru": (14400, 3100, 12600, 78000),
    "tavago.ru": (11900, 2600, 10400, 64000),
    "vent-style.ru": (9600, 2100, 8400, 52000),
    "teplodvor.ru": (8300, 1800, 7200, 46000),
    "teplomatica.ru": (7100, 1550, 6200, 39000),
    "teplovodservice.ru": (6000, 1300, 5200, 33000),
    "klimatov.ru": (5400, 1180, 4700, 29000),
    "comtermo.ru": (4800, 1040, 4200, 26000),
    "neuroclimat.ru": (4100, 890, 3600, 22000),
    "mnogo-tepla.ru": (3500, 760, 3100, 19000),
    "santehmir.ru": (3000, 650, 2600, 16500),
    "teplotehnika.net": (2400, 520, 2100, 13000),
}

WORDS = [
    "кондиционер купить", "сплит система цена", "мобильный кондиционер",
    "кондиционер с установкой", "вентиляция для дома", "приточная вентиляция",
    "осушитель воздуха", "увлажнитель воздуха купить", "тепловентилятор",
    "инфракрасный обогреватель", "конвектор электрический", "тепловая завеса",
    "бризер для квартиры", "рекуператор воздуха", "чиллер для кондиционера",
    "мульти сплит система", "канальный кондиционер", "кассетный кондиционер",
    "кондиционер инверторный", "обслуживание кондиционеров",
    "кондиционер для серверной", "прецизионный кондиционер",
    "фанкойл купить", "установка кондиционера цена", "масляный радиатор",
    "конвектор газовый", "теплый пол водяной", "котёл отопительный",
    "радиатор отопления купить", "бойлер косвенного нагрева",
    "насос циркуляционный", "воздушное отопление дома",
    "инфракрасная сауна", "осушитель для бассейна",
    "приточная установка цена", "вытяжной вентилятор купить",
    "фильтр для приточной вентиляции", "очиститель воздуха",
    "увлажнитель для детей", "обогреватель для теплицы",
    "кондиционер настенный", "монтаж вентиляции",
    "проектирование вентиляции", "тепловая пушка электрическая",
    "газовый конвектор для дома", "электрический котел отопления",
    "гребенка для теплого пола", "радиатор алюминиевый",
    "кондиционер с wifi", "заправка кондиционера",
]

# Насколько охотно домен появляется в выдаче по нашим запросам.
STRENGTH = {
    "dns-shop.ru": 0.90, "vseinstrumenti.ru": 0.86, "mvideo.ru": 0.82, "lemanapro.ru": 0.74,
    "lunda.ru": 0.62, "santech.ru": 0.58, "mircli.ru": 0.52,
    "master-water.ru": 0.42, "tavago.ru": 0.40, "vent-style.ru": 0.37, "teplodvor.ru": 0.35,
    "teplomatica.ru": 0.33, "teplovodservice.ru": 0.31, "klimatov.ru": 0.30, "comtermo.ru": 0.28,
    "neuroclimat.ru": 0.26, "mnogo-tepla.ru": 0.24, "santehmir.ru": 0.22, "teplotehnika.net": 0.20,
}


def months(count=12):
    now = datetime.now(timezone.utc)
    result = []
    for shift in range(count - 1, -1, -1):
        total = now.year * 12 + (now.month - 1) - shift
        result.append(f"{total // 12}.{total % 12 + 1:02d}")
    return result


def build_summary(domain, base, index):
    vis, it10, traf, pages = PROFILE[domain]
    factor = 1.0 if base == "msk" else 0.42
    drift = 1.0 + index * 0.006

    summary = {
        "domain": domain,
        "id": 29000000 + index,
        "it1": int(vis * 2.9 * factor),
        "it3": int(it10 / 4.2 * factor * drift),
        "it5": int(it10 / 1.9 * factor * drift),
        "it10": int(it10 * factor * drift),
        "it50": int(it10 * 3.4 * factor * drift),
        "vis": int(vis * factor * drift),
        "topvis": random.randint(80, 420),
        "topkeys": int(it10 * 1.6),
        "pagesinindex": pages,
        "adtraf": int(traf * 0.08),
        "adscnt": random.randint(0, 2200),
        "adkeyscnt": random.randint(0, 88000),
        "adcost": random.randint(0, 4200000),
        "adcost_max": random.randint(2000000, 9000000),
        "context_ads": random.randint(0, 1400),
        "context_adkeys": random.randint(0, 18000),
        "context_concs": random.randint(0, 160),
        "ai_answers": random.randint(0, 4200),
        "delta": {
            "it1": random.randint(-3200, 3600),
            "it3": random.randint(-900, 1100),
            "it5": random.randint(-1400, 1700),
            "it10": random.randint(-2100, 2600),
            "it50": random.randint(-4200, 5100),
            "vis": random.randint(-3900, 4400),
            "topvis": random.randint(-25, 30),
            "pagesinindex": random.randint(-3200, 4100),
            "adtraf": random.randint(-1600, 1900),
            "ai_answers": random.randint(-180, 240),
        },
    }
    return summary


def build_history(summary, pages):
    result = []
    for i, period in enumerate(months(12)):
        wave = 1.0 + (i - 6) * 0.017 + random.uniform(-0.035, 0.035)
        result.append({
            "period": period,
            "it1": int(summary["it1"] * wave),
            "it3": int(summary["it3"] * wave),
            "it5": int(summary["it5"] * wave),
            "it10": int(summary["it10"] * wave),
            "it50": int(summary["it50"] * wave),
            "vis": int(summary["vis"] * wave),
            "pages": int(pages * (1 + i * 0.01)),
            "ads": int(summary["adscnt"] * wave),
            "ai": random.randint(0, 480),
        })
    return result


def word_positions():
    """Для каждого запроса решаем, какие домены в нём вообще присутствуют."""
    presence = {}
    for word in WORDS:
        # Запрос может быть «нашим» с разной вероятностью — от 1 до 45 места.
        site_pos = random.randint(1, 45)
        shown = {}
        for domain, strength in STRENGTH.items():
            power = strength * random.uniform(0.45, 1.5)
            if power < 0.34:
                continue  # домена по этому запросу в выдаче нет
            if power > 0.95:
                pos = random.randint(1, 5)
            elif power > 0.70:
                pos = random.randint(1, 12)
            elif power > 0.50:
                pos = random.randint(5, 30)
            else:
                pos = random.randint(15, 90)
            shown[domain] = {
                "pos": pos,
                "delta": random.randint(-11, 11),
                "url": "/" + random.choice(["catalog", "product", "brand", "solutions"]) + f"/{random.randint(100, 9999)}/",
            }
        presence[word] = {"site": site_pos, "others": shown}
    return presence


def build_domain_entry(domain, base, index, presence, is_site):
    summary = build_summary(domain, base, index)
    vis = PROFILE[domain][0]
    pages = PROFILE[domain][3]
    history = build_history(summary, pages)

    rows = []
    for word in WORDS:
        info = presence[word]
        if is_site:
            rows.append({
                "word": word,
                "url": "/catalog/" + f"{random.randint(100, 9999)}/",
                "ws": random.randint(1800, 120000),
                "wsk": random.randint(400, 52000),
                "pos": info["site"],
                "delta": random.randint(-8, 8),
                "avbid": random.randint(2, 120),
                "serpf": "24.09.2026",
            })
        else:
            cell = info["others"].get(domain)
            if not cell:
                continue  # по этому запросу конкурента в выдаче нет
            rows.append({
                "word": word,
                "url": cell["url"],
                "ws": random.randint(1800, 120000),
                "wsk": random.randint(400, 52000),
                "pos": cell["pos"],
                "delta": cell["delta"],
                "avbid": random.randint(2, 120),
                "serpf": "24.09.2026",
            })

    rows.sort(key=lambda r: r["wsk"], reverse=True)
    return {
        "summary": summary,
        "history": history,
        "keywords": {"total": random.randint(4000, 90000), "matched": len(rows), "rows": rows},
        "error": None,
    }


def build_recent_keywords(per_domain_map, site, limit=25):
    merged = {}
    for domain, payload in per_domain_map.items():
        for row in payload["keywords"]["rows"]:
            entry = merged.setdefault(row["word"], {"word": row["word"], "ws": 0, "wsk": 0, "pos": {}})
            entry["ws"] = max(entry["ws"], row["ws"])
            entry["wsk"] = max(entry["wsk"], row["wsk"])
            entry["pos"][domain] = {"pos": row["pos"], "delta": row["delta"], "url": row["url"]}
    rows = [v for v in merged.values() if site in v["pos"]]
    rows.sort(key=lambda r: r["wsk"], reverse=True)
    return rows[:limit]


def main():
    with open(CONFIG_PATH, encoding="utf-8") as fh:
        config = json.load(fh)

    site = config["site"]
    groups = config["groups"]
    bases = config.get("bases") or ["msk"]
    competitors = [d for g in groups for d in g["domains"]]
    domains = [site] + competitors

    os.makedirs(DATA_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc)

    store = {
        "site": site,
        "generated_at": stamp.isoformat(timespec="seconds"),
        "generated_at_msk": (stamp + timedelta(hours=3)).strftime("%d.%m.%Y %H:%M"),
        "previous_at": (stamp - timedelta(hours=3)).isoformat(timespec="seconds"),
        "previous_at_msk": (stamp - timedelta(hours=3) + timedelta(hours=3)).strftime("%d.%m.%Y %H:%M"),
        "bases": bases,
        "groups": groups,
        "competitors": competitors,
        "selected_by_default": [d for d in config.get("selected_by_default", []) if d in competitors],
        "domains": {},
        "errors": [],
        "demo": True,
    }

    for base in bases:
        presence = word_positions()
        store["domains"][base] = {}
        for index, domain in enumerate(domains):
            entry = build_domain_entry(domain, base, index, presence, domain == site)
            store["domains"][base][domain] = entry
            if domain != site:
                missing = len(WORDS) - entry["keywords"]["matched"]
                if missing:
                    pass  # в реальном сборе тут было бы предупреждение, в демо это норма

    store["keywords_recent"] = build_recent_keywords(store["domains"][bases[0]], site)

    path = os.path.join(DATA_DIR, "latest.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(store, fh, ensure_ascii=False, separators=(",", ":"))

    # Пара контрольных цифр: сколько пересечений получилось по каждому домену.
    print(f"Демо-данные: {path} ({os.path.getsize(path)/1024:.0f} КБ)")
    print(f"Домены: {len(domains)} (сайт + {len(competitors)} конкурентов)")
    for base in bases:
        mini = min((store['domains'][base][d]['keywords']['matched'] for d in competitors), default=0)
        maxi = max((store['domains'][base][d]['keywords']['matched'] for d in competitors), default=0)
        print(f"  {base}: пересечений с нашими запросами от {mini} до {maxi} из {len(WORDS)}")
    print(f"Строк в таблице запросов: {len(store['keywords_recent'])}")


if __name__ == "__main__":
    main()
