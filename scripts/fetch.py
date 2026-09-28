#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сбор данных из API Keys.so для статического дашборда.

Скрипт запускается по расписанию (GitHub Actions), забирает отчёты
по сайту и конкурентам и складывает результат в data/*.json.
Токен читается только из переменной окружения KEYSO_TOKEN.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
CONFIG_PATH = os.path.join(ROOT, "config.json")

API_URL = "https://api.keys.so"
TOKEN = os.environ.get("KEYSO_TOKEN", "").strip()


# --------------------------------------------------------------------------
# Ограничитель частоты: не больше 10 запросов за 10 секунд (лимит Keys.so)
# --------------------------------------------------------------------------
class RateLimiter:
    def __init__(self, max_calls=10, period=10.0, delay=0.6):
        self.max_calls = max_calls
        self.period = period
        self.delay = delay
        self.calls = deque()

    def wait(self):
        while True:
            now = time.monotonic()
            while self.calls and now - self.calls[0] > self.period:
                self.calls.popleft()
            if len(self.calls) < self.max_calls:
                break
            sleep_for = self.period - (now - self.calls[0]) + 0.1
            if sleep_for > 0:
                print(f"    ... лимит запросов, пауза {sleep_for:.1f} c")
                time.sleep(sleep_for)
        self.calls.append(time.monotonic())
        time.sleep(self.delay)


LIMITER = RateLimiter()


class ApiError(Exception):
    pass


def api_get(path, params=None, retries=3):
    """GET-запрос к api.keys.so с повторами и ожиданием при статусе 202."""
    query = urllib.parse.urlencode(params or {}, doseq=True)
    url = f"{API_URL}{path}" + (f"?{query}" if query else "")

    last_error = None
    for attempt in range(1, retries + 1):
        LIMITER.wait()
        req = urllib.request.Request(url, headers={
            "X-Keyso-TOKEN": TOKEN,
            "Accept": "application/json",
            "User-Agent": "keys-so-dashboard/1.0",
        })
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                if resp.status == 202:
                    last_error = "отчёт ещё готовится (202)"
                    time.sleep(4)
                    continue
                return json.loads(body)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:200]
            if exc.code == 429:
                wait = int(exc.headers.get("Retry-After") or 10)
                print(f"    ! лимит исчерпан, ждём {wait} c")
                time.sleep(wait)
                last_error = "429"
                continue
            if exc.code == 404:
                raise ApiError(f"404: {detail}") from exc
            last_error = f"HTTP {exc.code}: {detail}"
        except Exception as exc:  # noqa: BLE001
            last_error = f"{type(exc).__name__}: {exc}"

        if attempt < retries:
            time.sleep(2 * attempt)

    raise ApiError(f"{path} -> {last_error}")


# --------------------------------------------------------------------------
# Нормализация ответов API
# --------------------------------------------------------------------------
def num(value, default=0):
    if isinstance(value, bool) or value is None:
        return default
    if isinstance(value, (int, float)):
        return value
    try:
        return float(str(value).replace(" ", "").replace(",", "."))
    except (TypeError, ValueError):
        return default


def intnum(value, default=0):
    return int(num(value, default))


def fetch_summary(domain, base):
    """«Шапка» домена + помесячная история видимости."""
    raw = api_get("/report/simple/domain_dashboard", {"base": base, "domain": domain})

    adcost = raw.get("adcost") or {}
    context = adcost.get("contextTotals") or {}

    summary = {
        "domain": raw.get("name") or domain,
        "id": raw.get("id"),
        "it1": intnum(raw.get("it1")),
        "it3": intnum(raw.get("it3")),
        "it5": intnum(raw.get("it5")),
        "it10": intnum(raw.get("it10")),
        "it50": intnum(raw.get("it50")),
        "vis": intnum(raw.get("vis")),
        "topvis": intnum(raw.get("topvis")),
        "topkeys": intnum(raw.get("topkeys")),
        "pagesinindex": intnum(raw.get("pagesinindex")),
        "adtraf": intnum(raw.get("adtraf")),
        "adscnt": intnum(raw.get("adscnt")),
        "adkeyscnt": intnum(raw.get("adkeyscnt")),
        "adcost": intnum(adcost.get("average")),
        "adcost_max": intnum(adcost.get("max")),
        "context_ads": intnum(context.get("ads")),
        "context_adkeys": intnum(context.get("adkeys")),
        "context_concs": intnum(context.get("ad_concs")),
    }

    history = []
    for period, point in (raw.get("history") or {}).items():
        if not isinstance(point, dict):
            continue
        history.append({
            "period": period,
            "it1": intnum(point.get("it1")),
            "it3": intnum(point.get("it3")),
            "it5": intnum(point.get("it5")),
            "it10": intnum(point.get("it10")),
            "it50": intnum(point.get("it50")),
            "vis": intnum(point.get("visAvg")),
            "pages": intnum(point.get("pagesInIndex")),
            "ads": intnum(point.get("adsCount")),
            "ai": intnum(point.get("aiCnt")),
        })
    history.sort(key=lambda item: item["period"])

    return summary, history


def fetch_keywords(domain, base, limit):
    """Топ запросов домена, отсортированных по потенциальному трафику."""
    pay = {
        "base": base,
        "domain": domain,
        "per_page": min(max(limit, 10), 100),
        "page": 1,
        "sort": "wsk|desc",
    }
    try:
        raw = api_get("/report/simple/organic/keywords", pay)
    except ApiError:
        pay["sort"] = "ws|desc"
        raw = api_get("/report/simple/organic/keywords", pay)

    rows = []
    for item in raw.get("data") or []:
        rows.append({
            "word": item.get("word"),
            "url": item.get("url"),
            "ws": intnum(item.get("ws")),
            "wsk": intnum(item.get("wsk")),
            "pos": intnum(item.get("pos")),
            "delta": intnum(item.get("delta")),
            "avbid": intnum(item.get("avbid")),
            "serpf": item.get("serpf"),
        })
    return {
        "total": intnum(raw.get("total")),
        "rows": rows[:limit],
    }


def build_recent_keywords(store, limit=20):
    """Собирает единый список запросов сайта с позициями по всем конкурентам."""
    merged = {}
    for domain, payload in store["domains"].items():
        rows = (payload.get("keywords") or {}).get("rows") or []
        for row in rows:
            word = row.get("word")
            if not word:
                continue
            entry = merged.setdefault(word, {"word": word, "ws": 0, "wsk": 0, "pos": {}})
            entry["ws"] = max(entry["ws"], row.get("ws") or 0)
            entry["wsk"] = max(entry["wsk"], row.get("wsk") or 0)
            entry["pos"][domain] = {
                "pos": row.get("pos") or 0,
                "delta": row.get("delta") or 0,
                "url": row.get("url") or "",
            }

    site = store["site"]
    rows = [item for item in merged.values() if site in item["pos"]]
    rows.sort(key=lambda item: (item["wsk"], item["ws"]), reverse=True)
    return rows[:limit]


def load_previous(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:  # noqa: BLE001
        return None


# --------------------------------------------------------------------------
def main():
    if not TOKEN:
        print("ОШИБКА: не задан KEYSO_TOKEN", file=sys.stderr)
        return 2

    with open(CONFIG_PATH, encoding="utf-8") as fh:
        config = json.load(fh)

    site = config["site"]
    competitors = [d for d in config.get("competitors", []) if d and d != site]
    domains = [site] + competitors
    bases = config.get("bases") or ["msk"]
    kw_limit = int(config.get("keywords_per_domain", 50))
    months = int(config.get("trend_months", 12))
    retries = int(config.get("api", {}).get("max_retries", 3))

    os.makedirs(DATA_DIR, exist_ok=True)
    latest_path = os.path.join(DATA_DIR, "latest.json")
    previous = load_previous(latest_path)

    print(f"Сайт: {site}")
    print(f"Конкуренты: {', '.join(competitors) or '—'}")
    print(f"Регионы: {', '.join(bases)}")
    print(f"Домены: {len(domains)} x баз: {len(bases)}\n")

    store = {
        "site": site,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generated_at_msk": (datetime.now(timezone.utc) + timedelta(hours=3)).strftime("%d.%m.%Y %H:%M"),
        "bases": bases,
        "competitors": competitors,
        "domains": {},
        "errors": [],
    }

    for base in bases:
        store["domains"][base] = {}
        print(f"== База {base} ==")
        for domain in domains:
            print(f"  -> {domain}")
            entry = {}
            try:
                summary, history = fetch_summary(domain, base)
                entry["summary"] = summary
                entry["history"] = history[-months:]
            except ApiError as exc:
                print(f"     ! нет данных: {exc}")
                store["errors"].append(f"{base}/{domain}: «шапка» — {exc}")

            try:
                entry["keywords"] = fetch_keywords(domain, base, kw_limit)
            except ApiError as exc:
                print(f"     ! нет запросов: {exc}")
                entry["keywords"] = {"total": 0, "rows": []}
                store["errors"].append(f"{base}/{domain}: запросы — {exc}")

            store["domains"][base][domain] = entry

    # Дельта к предыдущему снимку — считается один раз здесь,
    # чтобы фронтенду не пришлось ничего пересчитывать.
    prev_domains = (previous or {}).get("domains") or {}
    for base, per_domain in store["domains"].items():
        for domain, entry in per_domain.items():
            summary = entry.get("summary")
            if not summary:
                continue
            old = ((prev_domains.get(base) or {}).get(domain) or {}).get("summary")
            if not old:
                summary["delta"] = None
                continue
            summary["delta"] = {
                key: intnum(summary.get(key)) - intnum(old.get(key))
                for key in ("it1", "it3", "it5", "it10", "it50", "vis", "topvis", "pagesinindex", "adtraf")
            }
    store["previous_at"] = (previous or {}).get("generated_at")
    store["previous_at_msk"] = (previous or {}).get("generated_at_msk")

    # Данные текущей базовой базы кладём «плоско» — дашборд открывается с них.
    primary = bases[0]
    store["keywords_recent"] = build_recent_keywords(
        {"site": site, "domains": store["domains"][primary]}, limit=20
    )

    with open(latest_path, "w", encoding="utf-8") as fh:
        json.dump(store, fh, ensure_ascii=False, separators=(",", ":"))

    # Архив снимка — на случай, если понадобится история изменений.
    archive_dir = os.path.join(DATA_DIR, "archive")
    os.makedirs(archive_dir, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    with open(os.path.join(archive_dir, f"{stamp}.json"), "w", encoding="utf-8") as fh:
        json.dump(store, fh, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(latest_path) / 1024
    print(f"\nГотово: data/latest.json ({size_kb:.0f} КБ), снимков в архиве: {len(os.listdir(archive_dir))}")
    if store["errors"]:
        print(f"Предупреждений: {len(store['errors'])}")
        for err in store["errors"][:10]:
            print(f"  - {err}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
