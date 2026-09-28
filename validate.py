#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Проверка целостности data/latest.json перед публикацией.

Запуск: python3 scripts/validate.py
Код возврата 0 — данные пригодны для дашборда, 1 — есть проблемы.
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "data", "latest.json")

REQUIRED_DOMAIN_FIELDS = ["it1", "it3", "it5", "it10", "it50", "vis", "topvis", "pagesinindex"]
REQUIRED_HISTORY_FIELDS = ["period", "it10", "vis"]


def fail(message):
    print(f"  x {message}")
    return 1


def main():
    problems = 0

    if not os.path.exists(PATH):
        print("Файл data/latest.json не найден — сначала запустите scripts/fetch.py")
        return 1

    with open(PATH, encoding="utf-8") as fh:
        store = json.load(fh)

    print(f"Файл: {PATH} ({os.path.getsize(PATH)/1024:.0f} КБ)")

    if not store.get("generated_at"):
        problems += fail("нет поля generated_at")
    else:
        print(f"  v снимок от {store.get('generated_at_msk') or store['generated_at']}")

    bases = store.get("bases") or []
    if not bases:
        problems += fail("не указаны базовые регионы")

    domains_map = store.get("domains") or {}

    for base in bases:
        per_domain = domains_map.get(base)
        if not per_domain:
            problems += fail(f"база {base}: нет данных по доменам")
            continue
        expected = [store["site"]] + [d for d in store.get("competitors", []) if d != store["site"]]
        for domain in expected:
            entry = per_domain.get(domain)
            if not entry:
                problems += fail(f"{base}/{domain}: домен отсутствует в снимке")
                continue
            summary = entry.get("summary")
            if not summary:
                problems += fail(f"{base}/{domain}: нет «шапки» (report/simple/domain_dashboard)")
                continue
            for field in REQUIRED_DOMAIN_FIELDS:
                if field not in summary:
                    problems += fail(f"{base}/{domain}: в «шапке» нет поля {field}")
            history = entry.get("history") or []
            if not history:
                problems += fail(f"{base}/{domain}: пустая история видимости")
            else:
                for point in history[:1]:
                    for field in REQUIRED_HISTORY_FIELDS:
                        if field not in point:
                            problems += fail(f"{base}/{domain}: в истории нет поля {field}")
            keywords = entry.get("keywords") or {}
            if not (keywords.get("rows")):
                problems += fail(f"{base}/{domain}: пустой список запросов")
            elif "pos" not in keywords["rows"][0] or "word" not in keywords["rows"][0]:
                problems += fail(f"{base}/{domain}: в запросах нет полей word/pos")

    recent = store.get("keywords_recent") or []
    if not recent:
        problems += fail("keywords_recent пуст — таблица запросов не построится")
    else:
        first = recent[0]
        if store["site"] not in (first.get("pos") or {}):
            problems += fail(f"в keywords_recent нет позиций сайта {store['site']}")

    print()
    if problems:
        print(f"Проблем: {problems}. Дашборд покажет то, что удалось собрать.")
        return 1

    primary = bases[0]
    print("Данные корректны. Домены:", ", ".join(domains_map[primary].keys()))
    print("Запросов в таблице:", len(recent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
