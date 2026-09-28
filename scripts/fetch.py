#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сбор данных из API Keys.so для статического дашборда.

Запускается по расписанию (GitHub Actions), забирает отчёты по сайту
и конкурентам и складывает результат в data/latest.json.
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


def api_get(path, params=None, retries=3, timeout=90):
    """GET-запрос к api.keys.so с повторами и ожиданием при статусе 202."""
    query = urllib.parse.urlencode(params or {}, doseq=True)
    url = f"https://api.keys.so{path}" + (f"?{query}" if query else "")

    last_error = None
    for attempt in range(1, retries + 1):
        LIMITER.wait()
        req = urllib.request.Request(url, headers={
            "X-Keyso-TOKEN": TOKEN,
            "Accept": "application/json",
            "User-Agent": "keys-so-dashboard/1.1",
        })
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
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
                last_error = "429 Исчерпан лимит запросов по тарифному плану"
                continue
            if exc.code == 404:
                raise ApiError(f"404 (нет данных): {detail}") from exc
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


def fetch_summary(domain, base, timeout):
    """«Шапка» домена + помесячная история видимости.

    Отчёт /report/simple/domain_dashboard отдаёт и текущие метрики,
    и историю по месяцам, поэтому отдельный запрос за динамикой не нужен.
    """
    raw = api_get("/report/simple/domain_dashboard",
                  {"base": base, "domain": domain}, timeout=timeout)

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
        "ai_answers": intnum(raw.get("aiAnswersCnt")),
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


def fetch_keywords(domain, base, per_page, timeout, only_words=None):
    """Запросы домена, отсортированные по потенциальному трафику.

    only_words — если задан набор, оставляем только эти запросы.
    По конкурентам храним не весь их список, а позиции по запросам нашего
    сайта: иначе файл данных распухает, когда конкурентов два десятка.
    """
    pay = {
        "base": base,
        "domain": domain,
        "per_page": min(max(int(per_page), 10), 100),
        "page": 1,
        "sort": "wsk|desc",
    }
    try:
        raw = api_get("/report/simple/organic/keywords", pay, timeout=timeout)
    except ApiError:
        pay["sort"] = "ws|desc"
        raw = api_get("/report/simple/organic/keywords", pay, timeout=timeout)

    rows = []
    for item in raw.get("data") or []:
        word = item.get("word")
        if not word:
            continue
        if only_words is not None and word not in only_words:
            continue
        rows.append({
            "word": word,
            "url": item.get("url"),
            "ws": intnum(item.get("ws")),
            "wsk": intnum(item.get("wsk")),
            "pos": intnum(item.get("pos")),
            "delta": intnum(item.get("delta")),
            "avbid": intnum(item.get("avbid")),
            "serpf": item.get("serpf"),
        })

    return {"total": intnum(raw.get("total")), "matched": len(rows), "rows": rows}


def collect(domain, base, per_page, timeout, only_words=None):
    entry = {"summary": None, "history": [], "error": None}
    try:
        summary, history = fetch_summary(domain, base, timeout)
        entry["summary"] = summary
        entry["history"] = history
    except ApiError as exc:
        print(f"     ! нет «шапки»: {exc}")
        entry["error"] = str(exc)[:300]

    try:
        entry["keywords"] = fetch_keywords(domain, base, per_page, timeout, only_words)
    except ApiError as exc:
        print(f"     ! нет запросов: {exc}")
        entry["keywords"] = {"total": 0, "matched": 0, "rows": []}
        if not entry.get("error"):
            entry["error"] = str(exc)[:300]

    return entry


def build_recent_keywords(per_domain_map, site, limit=25):
    """Сводит запросы сайта с позициями конкурентов в один плоский список."""
    merged = {}
    for domain, payload in per_domain_map.items():
        for row in ((payload.get("keywords") or {}).get("rows") or []):
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

    rows = [item for item in merged.values() if site in item["pos"]]
    rows.sort(key=lambda item: (item["wsk"], item["ws"]), reverse=True)
    return rows[:limit]


def load_previous(path):
    """Предыдущий снимок для расчёта дельт.

    Демонстрационный снимок намеренно игнорируется: сравнивать реальные
    цифры с выдуманными нельзя, иначе первый запуск покажет ложную динамику.
    """
    try:
        with open(path, encoding="utf-8") as fh:
            previous = json.load(fh)
    except Exception:  # noqa: BLE001
        return None
    if previous.get("demo"):
        print("Предыдущий снимок был демонстрационным — пропускаем сравнение\n")
        return None
    return previous


def flatten_groups(config):
    """Разворачивает группы конкурентов в плоский список доменов."""
    groups = []
    seen = set()
    for group in config.get("groups") or []:
        domains = []
        for domain in group.get("domains") or []:
            domain = str(domain).strip()
            if not domain or domain == config["site"] or domain in seen:
                continue
            seen.add(domain)
            domains.append(domain)
        if domains:
            groups.append({
                "id": group.get("id") or "group",
                "title": group.get("title") or "",
                "domains": domains,
            })
    return groups


def main():
    if not TOKEN:
        print("ОШИБКА: не задан KEYSO_TOKEN", file=sys.stderr)
        return 2

    with open(CONFIG_PATH, encoding="utf-8") as fh:
        config = json.load(fh)

    site = config["site"]
    groups = flatten_groups(config)
    competitors = [d for group in groups for d in group["domains"]]
    if not competitors:
        print("ОШИБКА: в config.json не описано ни одного конкурента", file=sys.stderr)
        return 2

    bases = config.get("bases") or ["msk"]
    kw_limit = int(config.get("keywords_per_domain", 50))
    comp_kw_limit = int(config.get("competitor_keywords", 100))
    months = int(config.get("trend_months", 12))
    timeout = int((config.get("api") or {}).get("timeout", 90))

    os.makedirs(DATA_DIR, exist_ok=True)
    latest_path = os.path.join(DATA_DIR, "latest.json")
    previous = load_previous(latest_path)

    total_requests = len(bases) * (1 + len(competitors)) * 2
    print(f"Сайт: {site}")
    print(f"Конкурентов: {len(competitors)} в {len(groups)} группах")
    print(f"Регионы: {', '.join(bases)}")
    print(f"Запросов к API за запуск: ~{total_requests}\n")

    store = {
        "site": site,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generated_at_msk": (datetime.now(timezone.utc) + timedelta(hours=3)).strftime("%d.%m.%Y %H:%M"),
        "bases": bases,
        "groups": groups,
        "competitors": competitors,
        "selected_by_default": [d for d in (config.get("selected_by_default") or []) if d in competitors],
        "domains": {},
        "errors": [],
    }

    for base in bases:
        store["domains"][base] = {}
        print(f"== База {base} ==")

        # 1) Наш сайт — полный список запросов. Он задаёт выборку для конкурентов.
        print(f"  -> {site} (наш сайт)")
        site_entry = collect(site, base, kw_limit, timeout)
        site_words = {row["word"] for row in site_entry["keywords"]["rows"]}
        store["domains"][base][site] = site_entry
        if site_entry.get("error"):
            store["errors"].append(f"{base}/{site}: {site_entry['error']}")
        print(f"     запросов в выборке: {len(site_words)}")

        # 2) Конкуренты — только те запросы, что есть у нас.
        for domain in competitors:
            print(f"  -> {domain}")
            entry = collect(domain, base, comp_kw_limit, timeout, only_words=site_words)
            store["domains"][base][domain] = entry
            if entry.get("error"):
                store["errors"].append(f"{base}/{domain}: {entry['error']}")
            print(f"     пересечение с нашими запросами: {entry['keywords']['matched']}")

    # Дельта к предыдущему снимку: считаем здесь, чтобы фронтенд ничего не пересчитывал.
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

    primary = bases[0]
    store["keywords_recent"] = build_recent_keywords(store["domains"][primary], site, limit=25)

    with open(latest_path, "w", encoding="utf-8") as fh:
        json.dump(store, fh, ensure_ascii=False, separators=(",", ":"))

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
