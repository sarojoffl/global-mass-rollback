import re
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

import requests

# everything that talks to the wikis

meta_api = "https://meta.wikimedia.org/w/api.php"
allowed_groups = ("global-rollbacker", "steward", "global-sysop")
# wikis asked at once per search, it is mostly waiting on the network
fetch_threads = 16
# stop asking more projects once this many edits are in
stop_after = 200
timeout = 15

http = requests.Session()
http.mount("https://", requests.adapters.HTTPAdapter(pool_connections=64, pool_maxsize=fetch_threads))
http.headers.update({"User-Agent": "GlobalMassRollback (https://meta.wikimedia.org/wiki/User:Saroj)"})

def get_json(url, params):
    r = http.get(url, params={**params, "format": "json", "formatversion": "2"}, timeout=timeout)
    r.raise_for_status()
    return r.json()


def global_groups(username):
    try:
        d = get_json(meta_api, {"action": "query", "meta": "globaluserinfo", "guiuser": username, "guiprop": "groups"})
        return d.get("query", {}).get("globaluserinfo", {}).get("groups", [])
    except Exception as e:
        print("global groups check failed:", e)
        return []


def is_authorized(username):
    return any(g in allowed_groups for g in global_groups(username))


# project list for the filter, cached a day

_wikis = {"at": 0, "list": []}
_wikis_lock = threading.Lock()


def all_wikis():
    with _wikis_lock:
        if _wikis["list"] and time.time() - _wikis["at"] < 86400:
            return _wikis["list"]
    try:
        d = get_json(meta_api, {"action": "sitematrix", "smtype": "language|special", "smstate": "all", "smlangprop": "site", "smsiteprop": "url|dbname"})
    except Exception as e:
        print("sitematrix failed:", e)
        return _wikis["list"]
    found = []
    for key, v in d.get("sitematrix", {}).items():
        if key == "count":
            continue
        sites = v.get("site", []) if isinstance(v, dict) else v
        for s in sites:
            if s.get("closed") or s.get("private") or s.get("fishbowl") or s.get("nonglobal"):
                continue
            found.append({"db": s["dbname"], "url": s["url"]})
    found.sort(key=lambda w: w["db"])
    with _wikis_lock:
        _wikis.update(at=time.time(), list=found)
    return found


def api_for(db):
    # only open public wikis from the sitematrix, never a url from the browser
    w = next((w for w in all_wikis() if w["db"] == db), None)
    return w["url"] + "/w/api.php" if w else None


# contributions

def merged_accounts(username):
    d = get_json(meta_api, {"action": "query", "meta": "globaluserinfo", "guiuser": username, "guiprop": "merged"})
    info = d.get("query", {}).get("globaluserinfo", {})
    if info.get("missing"):
        return None
    # drop projects with 0 edits, then most edits first
    found = [m for m in info.get("merged", []) if m.get("editcount", 0) > 0]
    return sorted(found, key=lambda m: -m["editcount"])


def text_match(edit, f):
    if f.get("comment") and f["comment"].lower() not in (edit.get("comment") or "").lower():
        return False
    if f.get("title") and f["title"].lower() not in (edit.get("title") or "").lower():
        return False
    return True


def rollbackable(api, edits):
    # rollback needs an earlier revision by someone else. page creations never
    # have one, and if the user made the previous revision too we ask the page
    edits = [e for e in edits if e["parentid"]]
    parents = {}
    for i in range(0, len(edits), 50):
        ids = "|".join(str(e["parentid"]) for e in edits[i:i + 50])
        d = get_json(api, {"action": "query", "prop": "revisions", "revids": ids, "rvprop": "ids|user"})
        for page in d.get("query", {}).get("pages", []):
            for r in page.get("revisions", []):
                parents[r["revid"]] = r.get("user")
    keep = []
    for e in edits:
        by = parents.get(e["parentid"])
        if by and by != e["user"]:
            keep.append(e)
            continue
        # same user before (or hidden), see if anyone else ever edited the page
        d = get_json(api, {"action": "query", "prop": "revisions", "titles": e["title"], "rvlimit": 1, "rvexcludeuser": e["user"], "rvprop": "ids"})
        pages = d.get("query", {}).get("pages", [])
        if pages and pages[0].get("revisions"):
            keep.append(e)
    return keep


def wiki_contribs(username, wiki, url, f, limit, cont):
    # text filters and the rollback check aren't in the api, so page a few times until enough match
    api = url + "/w/api.php"
    params = {
        "action": "query", "list": "usercontribs", "ucuser": username, "ucshow": "top",
        "ucprop": "ids|title|timestamp|comment|sizediff|flags|tags", "uclimit": min(limit, 500),
    }
    if f.get("namespace") not in (None, ""):
        params["ucnamespace"] = f["namespace"]
    if f.get("tag"):
        params["uctag"] = f["tag"]
    if f.get("to"):
        params["ucstart"] = f["to"] + "T23:59:59Z"
    if f.get("from"):
        params["ucend"] = f["from"] + "T00:00:00Z"

    picked, pages = [], 0
    while True:
        p = dict(params)
        if cont:
            p["uccontinue"] = cont
        d = get_json(api, p)
        pages += 1
        batch = []
        for c in d.get("query", {}).get("usercontribs", []):
            if text_match(c, f):
                batch.append({
                    "wiki": wiki, "wiki_url": url, "wiki_api": api, "revid": c["revid"], "parentid": c.get("parentid", 0),
                    "title": c["title"], "ns": c.get("ns", 0), "timestamp": c["timestamp"], "comment": c.get("comment", ""),
                    "sizediff": c.get("sizediff"), "new": bool(c.get("new")), "minor": bool(c.get("minor")), "tags": c.get("tags", []),
                    "user": c.get("user", username),
                })
        picked += rollbackable(api, batch)
        cont = d.get("continue", {}).get("uccontinue")
        if not cont or len(picked) >= limit or pages >= 5:
            return picked[:limit], cont, picked[limit:]


def contribs(username, f, limit, conts=None):
    # conts: wiki -> uccontinue for load more, "" means not asked yet
    accounts = merged_accounts(username)
    if accounts is None:
        return None
    if f.get("wikis"):
        wanted = set(f["wikis"])
        accounts = [a for a in accounts if a["wiki"] in wanted]
    if conts:
        accounts = [a for a in accounts if a["wiki"] in conts]

    # stop asking new projects once we have this many edits, load more does the rest
    enough = max(stop_after, limit)
    results, errors = {}, []

    def work(a):
        try:
            results[a["wiki"]] = wiki_contribs(username, a["wiki"], a["url"], f, limit, (conts or {}).get(a["wiki"]))
        except Exception as e:
            errors.append(a["wiki"])
            print(f"contribs failed on {a['wiki']}:", e)

    todo = list(accounts)
    with ThreadPoolExecutor(max_workers=fetch_threads) as pool:
        running = set()
        while todo or running:
            found = sum(len(r[0]) for r in results.values())
            while todo and len(running) < fetch_threads and found < enough:
                running.add(pool.submit(work, todo.pop(0)))
            if not running:
                break
            done, running = wait(running, return_when=FIRST_COMPLETED)

    everything = [e for r in results.values() for e in r[0]]
    everything.sort(key=lambda e: e["timestamp"], reverse=True)
    shown = everything[:limit]

    # next time start at the first fetched edit we didn't show ("timestamp|revid")
    shown_ids = {(e["wiki"], e["revid"]) for e in shown}
    next_conts = {a["wiki"]: "" for a in todo}
    for wiki, (picked, cont, extra) in results.items():
        left = [e for e in picked + extra if (wiki, e["revid"]) not in shown_ids]
        if left:
            first = left[0]
            next_conts[wiki] = re.sub(r"\D", "", first["timestamp"]) + "|" + str(first["revid"])
        elif cont:
            next_conts[wiki] = cont

    return {"edits": shown, "next": next_conts, "failed_wikis": sorted(errors),
            "checked": len(accounts) - len(todo), "projects": len(accounts), "unchecked": len(todo)}


# rollback, signed with the user's oauth token

_tokens = {}
_tokens_lock = threading.Lock()


def rollback_token(api, user, auth, fresh=False):
    key = (user, api)
    with _tokens_lock:
        if not fresh and key in _tokens:
            return _tokens[key]
    r = http.get(api, params={"action": "query", "meta": "tokens", "type": "rollback", "format": "json"}, auth=auth, timeout=timeout)
    token = r.json()["query"]["tokens"]["rollbacktoken"]
    with _tokens_lock:
        _tokens[key] = token
    return token


def rollback(edit, actor, auth, markbot, summary=""):
    api = edit["wiki_api"]
    for attempt in (0, 1):
        token = rollback_token(api, actor, auth, fresh=attempt == 1)
        data = {"action": "rollback", "title": edit["title"], "user": edit["user"], "token": token, "format": "json"}
        if markbot:
            data["markbot"] = "1"
        if summary:
            data["summary"] = summary
        r = http.post(api, data=data, auth=auth, timeout=timeout).json()
        err = r.get("error")
        if err and err.get("code") == "badtoken" and attempt == 0:
            continue
        if err:
            return False, err.get("code", "unknown"), err.get("info", "")
        return True, None, ""
    return False, "badtoken", "Invalid token"
