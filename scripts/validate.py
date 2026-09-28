#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Проверка целостности data/latest.json перед публикацией.

Главный принцип: публикацию блокируют только те проблемы, из-за которых
дашборд реально не построится. Если данные просто неполные — недостаёт
конкурента, не собралась история по одному домену — это выводится как
предупреждение, но не мешает сохранить снимок.

Запуск: python3 scripts/validate.py
Код возврата 0 — можно публиковать, 1 — данные непригодны.
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "data", "latest.json")

REQUIRED_SUMMARY_FIELDS = ["it1", "it3", "it5", "it10", "it50", "vis", "topvis", "pagesinindex"]
REQUIRED_HISTORY_FIELDS = ["period", "it10", "vis"]

# Проблемы, которые блокируют публикацию. Всё остальное — предупреждения.
critical = []
warnings = []


def bad(message):
    print(f"    x {message}")
    critical.append(message)


def warn(message):
    print(f"    ! {message}")
    warnings.append(message)


def main():
    if not os.path.exists(PATH):
        print("Файл data/latest.json не найден — сначала запустите scripts/fetch.py")
        return 1

    with open(PATH, encoding="utf-8") as fh:
        store = json.load(fh)

    size_kb = os.path.getsize(PATH) / 1024
    print(f"Файл: {PATH} ({size_kb:.0f} КБ)")
    print()

    # --- то, без чего дашборд не соберётся совсем -------------------------
    if not store.get("generated_at"):
        bad("нет поля generated_at — неизвестно, когда собран снимок")
    else:
        mark = " (ДЕМО)" if store.get("demo") else ""
        print(f"  v снимок от {store.get('generated_at_msk') or store['generated_at']}{mark}")

    site = store.get("site")
    if not site:
        bad("не указан сайт")
        print()
        print("Данные непригодны.")
        return 1

    bases = store.get("bases") or []
    if not bases:
        bad("не указаны базовые регионы")

    domains_map = store.get("domains") or {}
    if not domains_map:
        bad("нет раздела domains")
        print()
        print("Данные непригодны.")
        return 1

    recent = store.get("keywords_recent") or []
    if not recent:
        bad("keywords_recent пуст — таблица запросов не построится")
    elif site not in ((recent[0].get("pos") or {})):
        bad(f"в keywords_recent нет позиций сайта {site}")

    # --- данные по самому сайту: без них дашборд бессмыслен ---------------
    for base in bases:
        per_domain = domains_map.get(base) or {}
        entry = per_domain.get(site)
        if not entry:
            bad(f"{base}: в снимке нет нашего сайта {site}")
            continue
        summary = entry.get("summary")
        if not summary:
            bad(f"{base}/{site}: не собралась «шапка» сайта")
        else:
            for field in REQUIRED_SUMMARY_FIELDS:
                if field not in summary:
                    bad(f"{base}/{site}: в «шапке» нет поля {field}")
        if not entry.get("history"):
            warn(f"{base}/{site}: пустая история видимости — график будет пустым")
        if not ((entry.get("keywords") or {}).get("rows")):
            warn(f"{base}/{site}: пустой список запросов")

    # --- конкуренты: неполнота допустима ----------------------------------
    competitors = store.get("competitors") or []
    groups = store.get("groups") or []
    if not groups:
        warn("в данных нет разбивки конкурентов по группам — таблица сравнения будет плоской")

    grouped = [d for g in groups for d in (g.get("domains") or [])]
    if groups and grouped != competitors:
        warn("список конкурентов расходится с разбивкой по группам")

    if site in competitors:
        warn("сайт попал в список конкурентов — уберите его из групп в config.json")

    print(f"  v конкурентов в отчёте: {len(competitors)}")

    for base in bases:
        per_domain = domains_map.get(base) or {}
        missing_summary = []
        missing_history = []
        no_keywords = []
        for domain in competitors:
            entry = per_domain.get(domain)
            if not entry or not entry.get("summary"):
                missing_summary.append(domain)
                continue
            if not entry.get("history"):
                missing_history.append(domain)
            if not ((entry.get("keywords") or {}).get("rows")):
                no_keywords.append(domain)

        if missing_summary:
            warn(f"{base}: без данных — {', '.join(missing_summary)} "
                 f"({len(missing_summary)} из {len(competitors)}; "
                 f"возможно, домена нет в базе Keys.so или опечатка в config.json)")
        if missing_history:
            warn(f"{base}: без истории видимости — {', '.join(missing_history)}")
        # Пустые запросы у конкурента — обычное дело: по нашим фразам его нет в топ-100.
        if no_keywords:
            print(f"  · {base}: без пересечений по нашим запросам — "
                  f"{', '.join(no_keywords)} (это нормально)")

    collected = len((store.get("errors") or []))
    if collected:
        warn(f"сбор зафиксировал ошибок по {collected} точкам — подробности в поле errors")

    with_rivals = sum(1 for row in recent if len(row.get("pos") or {}) > 1)
    if recent:
        print(f"  v запросов в таблице: {len(recent)}, из них с конкурентами: {with_rivals}")
        if with_rivals == 0:
            warn("ни в одном запросе нет позиций конкурентов — таблица будет только с нашим сайтом")

    # --- итог --------------------------------------------------------------
    print()
    if critical:
        print(f"Публикацию блокируют {len(critical)} проблем — данные непригодны:")
        for message in critical:
            print(f"  - {message}")
        return 1

    if warnings:
        print(f"Данные пригодны, но есть замечания: {len(warnings)}")
        for message in warnings:
            print(f"  - {message}")
        print()
        print("Снимок будет опубликован. Неполные блоки дашборд покажет пустыми.")
        return 0

    print(f"Данные корректны. Домены: {len(domains_map[bases[0]])}, баз: {len(bases)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
