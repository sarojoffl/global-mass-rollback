import fcntl
import json
import os
import threading
import time
from datetime import datetime, timezone

# simple usage stats in one json file. writes go to a temp file then
# os.replace under a file lock, and it lives in the tool home on toolforge
# so it survives rebuilds, plan to switch to toolsdb in future ;) 

online_window = 5 * 60
seen_gap = 60

if os.environ.get("GMR_DATA_DIR"):
    data_dir = os.environ["GMR_DATA_DIR"]
elif os.environ.get("TOOL_DATA_DIR"):
    data_dir = os.path.join(os.environ["TOOL_DATA_DIR"], "gmr-data")
else:
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

path = os.path.join(data_dir, "stats.json")
lock = threading.Lock()
last_write = {}


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def age(iso):
    try:
        return time.time() - datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    except (TypeError, ValueError):
        return 1e12


def read():
    for p in (path, path + ".bak"):
        try:
            with open(p, encoding="utf-8") as f:
                return {"users": {}, **json.load(f)}
        except (OSError, ValueError):
            continue
    return {"users": {}}


def change(fn):
    try:
        os.makedirs(data_dir, exist_ok=True)
        with lock, open(path + ".lock", "a") as lf:
            fcntl.flock(lf, fcntl.LOCK_EX)
            data = read()
            fn(data)
            with open(path + ".tmp", "w", encoding="utf-8") as f:
                json.dump(data, f)
                f.flush()
                os.fsync(f.fileno())
            if os.path.exists(path):
                os.replace(path, path + ".bak")
            os.replace(path + ".tmp", path)
    except OSError as e:
        print("could not save stats:", e)


def user(data, name):
    return data["users"].setdefault(name, {"last_seen": now(), "ok": 0, "failed": 0})


def seen(name, force=False):
    if not name:
        return
    with lock:
        if not force and time.time() - last_write.get(name, 0) < seen_gap:
            return
        last_write[name] = time.time()
    change(lambda data: user(data, name).update(last_seen=now()))


def rolled_back(name, ok):
    def fn(data):
        u = user(data, name)
        u["ok" if ok else "failed"] += 1
        u["last_seen"] = now()
    change(fn)


def summary():
    with lock:
        data = read()
    users = [{**u, "name": n, "online": age(u.get("last_seen")) < online_window} for n, u in data["users"].items()]
    users.sort(key=lambda u: (not u["online"], age(u.get("last_seen"))))
    return {
        "users": users,
        "ok": sum(u["ok"] for u in users),
        "failed": sum(u["failed"] for u in users),
        "online": sum(u["online"] for u in users),
    }
