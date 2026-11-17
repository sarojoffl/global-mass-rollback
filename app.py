# -*- coding: utf-8 -*-

import os
import sys
import time
import threading
import json
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed

from flask import Flask, render_template, request, jsonify, session, redirect
import requests
import mwoauth
from requests_oauthlib import OAuth1

# tomllib is built-in on Python 3.11+; fall back to tomli for older versions
if sys.version_info >= (3, 11):
    import tomllib
else:
    try:
        import tomli as tomllib
    except ImportError:
        tomllib = None

app = Flask(__name__, static_folder="static")

def asset_version():
    """Hash of static files so browsers pick up new CSS/JS immediately without caching stale versions."""
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    h = hashlib.sha1()
    for root, dirs, files in os.walk(static_dir):
        dirs.sort()
        for f in sorted(files):
            with open(os.path.join(root, f), "rb") as fh:
                h.update(fh.read())
    return h.hexdigest()[:10]

# ---------------- Config ----------------
# Try config.toml first (local dev), then fall back to environment variables
_conf = {}
_config_file = os.path.join(os.path.dirname(__file__), "config.toml")
if tomllib and os.path.exists(_config_file):
    with open(_config_file, "rb") as _f:
        _conf = tomllib.load(_f)


def _setting(name, env):
    """Read a config value: config.toml key (any case) or env var."""
    return _conf.get(name) or _conf.get(name.upper()) or os.environ.get(env)


SECRET_KEY = _setting("secret_key", "SECRET_KEY")
CONSUMER_KEY = _setting("consumer_key", "CONSUMER_KEY")
CONSUMER_SECRET = _setting("consumer_secret", "CONSUMER_SECRET")
OAUTH_MWURI = _setting("oauth_mwuri", "OAUTH_MWURI") or "https://meta.wikimedia.org/w/index.php"

if not SECRET_KEY or not CONSUMER_KEY or not CONSUMER_SECRET:
    raise RuntimeError("Missing required config: secret_key, consumer_key, consumer_secret")

app.secret_key = SECRET_KEY

# ---------------- Codex / CDN assets ----------------
_CDN = os.environ.get("GMR_CDN", "https://tools-static.wmflabs.org/cdnjs/ajax/libs")
ASSETS = {
    "vue":       os.environ.get("GMR_VUE_URL",       _CDN + "/vue/3.5.44/vue.esm-browser.prod.min.js"),
    "codex":     os.environ.get("GMR_CODEX_URL",     _CDN + "/codex/2.7.0/codex.min.js"),
    "icons":     os.environ.get("GMR_ICONS_URL",     _CDN + "/codex-icons/2.7.0/codex-icons.min.js"),
    "codex_css": os.environ.get("GMR_CODEX_CSS",     _CDN + "/codex/2.7.0/codex.style.css"),
    "tokens":    os.environ.get("GMR_TOKENS_CSS",    _CDN + "/codex-design-tokens/2.7.0/theme-wikimedia-ui.css"),
    "dark":      os.environ.get("GMR_DARK_CSS",      _CDN + "/codex-design-tokens/2.7.0/theme-wikimedia-ui-mode-dark.css"),
    "logo":      "https://upload.wikimedia.org/wikipedia/commons/6/6c/Meta-Wiki_Global_rollback.svg",
}

# ---------------- Requests session ----------------
session_requests = requests.Session()
session_requests.headers.update({
    "User-Agent": "GlobalMassRollback/1.1 (https://meta.wikimedia.org/wiki/User:Saroj)"
})

# ---------------- Settings ----------------
GLOBAL_EDIT_LIMIT = 50
MAX_WORKERS = 4
ROLLBACK_DELAY = 0.5
REQUEST_TIMEOUT = 10



# ============================================================
# OAuth Routes
# ============================================================

@app.route("/login")
def login():
    consumer_token = mwoauth.ConsumerToken(CONSUMER_KEY, CONSUMER_SECRET)
    try:
        redirect_url, request_token = mwoauth.initiate(OAUTH_MWURI, consumer_token)
        session["request_token"] = dict(zip(request_token._fields, request_token))
        return redirect(redirect_url)
    except Exception as e:
        print("OAuth initiate failed:", e)
        return redirect("/")


@app.route("/oauth/callback")
def oauth_callback():
    if "request_token" not in session:
        return redirect("/")

    consumer_token = mwoauth.ConsumerToken(CONSUMER_KEY, CONSUMER_SECRET)
    try:
        access_token = mwoauth.complete(
            OAUTH_MWURI,
            consumer_token,
            mwoauth.RequestToken(**session["request_token"]),
            request.query_string
        )
        identity = mwoauth.identify(OAUTH_MWURI, consumer_token, access_token)
        session["access_token"] = dict(zip(access_token._fields, access_token))
        session["username"] = identity["username"]
        session["is_authorized"] = is_authorized_user(identity["username"])
    except Exception as e:
        print("OAuth complete failed:", e)

    return redirect("/")


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


# ============================================================
# OAuth Request Helper
# ============================================================

def oauth_request(url, method="GET", data=None, params=None):
    if "access_token" not in session:
        return None

    access_token = mwoauth.AccessToken(**session["access_token"])
    consumer_token = mwoauth.ConsumerToken(CONSUMER_KEY, CONSUMER_SECRET)

    auth = OAuth1(
        client_key=consumer_token.key,
        client_secret=consumer_token.secret,
        resource_owner_key=access_token.key,
        resource_owner_secret=access_token.secret,
        signature_method='HMAC-SHA1',
        signature_type='AUTH_HEADER'
    )

    try:
        if method.upper() == "POST":
            return requests.post(
                url, auth=auth, data=data, params=params,
                headers=session_requests.headers, timeout=REQUEST_TIMEOUT
            )
        else:
            return requests.get(
                url, auth=auth, params=params,
                headers=session_requests.headers, timeout=REQUEST_TIMEOUT
            )
    except Exception as e:
        print("OAuth request error:", e)
        return None


# ============================================================
# Authorization Helper
# ============================================================

def is_authorized_user(username):
    meta_url = "https://meta.wikimedia.org/w/api.php"
    try:
        resp = session_requests.get(meta_url, params={
            "action": "query",
            "meta": "globaluserinfo",
            "guiuser": username,
            "guiprop": "groups",
            "format": "json"
        }, timeout=REQUEST_TIMEOUT).json()
        global_groups = resp.get("query", {}).get("globaluserinfo", {}).get("groups", [])
        return any(g in global_groups for g in ["global-rollbacker", "steward", "global-sysop"])
    except Exception as e:
        print("Auth check failed:", e)
        return False


# ============================================================
# Global Contributions
# ============================================================

def fetch_global_contribs(username, uccontinue_map=None):
    if uccontinue_map is None:
        uccontinue_map = {}

    meta_url = "https://meta.wikimedia.org/w/api.php"

    try:
        resp = session_requests.get(meta_url, params={
            "action": "query",
            "meta": "globaluserinfo",
            "guiuser": username,
            "guiprop": "merged",
            "format": "json"
        }, timeout=REQUEST_TIMEOUT).json()
    except Exception as e:
        print("Meta fetch error:", e)
        return [], {}

    merged = resp.get("query", {}).get("globaluserinfo", {}).get("merged", [])
    wiki_api_map = {
        w["wiki"]: w["url"] + "/w/api.php"
        for w in merged
        if w.get("editcount", 0) > 0
    }

    rollbackable = []
    next_uccontinue_map = {}
    lock = threading.Lock()

    def worker(wiki, api_url, continue_token=None):
        with lock:
            if len(rollbackable) >= GLOBAL_EDIT_LIMIT:
                return

        try:
            params = {
                "action": "query",
                "list": "usercontribs",
                "ucuser": username,
                "uclimit": 20,
                "ucprop": "title|ids|timestamp|user|comment|sizediff|flags",
                "format": "json"
            }
            if continue_token:
                params["uccontinue"] = continue_token

            response = session_requests.get(api_url, params=params, timeout=REQUEST_TIMEOUT)
            data = response.json()
            contribs = data.get("query", {}).get("usercontribs", [])

            for edit in contribs:
                if "top" in edit:
                    edit["wiki"] = wiki
                    edit["wiki_api"] = api_url
                    with lock:
                        if len(rollbackable) < GLOBAL_EDIT_LIMIT:
                            rollbackable.append(edit)
                        else:
                            return

            # Save uccontinue for next batch if available
            cont = data.get("continue", {}).get("uccontinue")
            if cont:
                next_uccontinue_map[wiki] = cont

        except Exception as e:
            print(f"Worker error ({wiki}):", e)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [
            executor.submit(worker, wiki, api, uccontinue_map.get(wiki))
            for wiki, api in wiki_api_map.items()
        ]
        for _ in as_completed(futures):
            pass

    rollbackable.sort(key=lambda x: x["timestamp"], reverse=True)
    return rollbackable[:GLOBAL_EDIT_LIMIT], next_uccontinue_map


# ============================================================
# Routes
# ============================================================

@app.route("/")
def index():
    return render_template(
        "index.html",
        assets=ASSETS,
        v=asset_version(),
        logged_in="access_token" in session,
        username=session.get("username"),
        is_authorized=session.get("is_authorized", False)
    )


@app.route("/get_global_contribs", methods=["POST"])
def get_global_contribs_route():
    if "access_token" not in session:
        return jsonify([])

    if not session.get("is_authorized"):
        return jsonify({"success": False, "message": "This tool is only for global rollbackers, stewards, and global sysops."})

    # Accept both JSON body and form-encoded body
    if request.is_json:
        body = request.get_json(force=True)
        username = body.get("username")
        raw_map = body.get("uccontinue_map", {})
        uccontinue_map = raw_map if isinstance(raw_map, dict) else json.loads(raw_map)
    else:
        username = request.form.get("username")
        raw_map = request.form.get("uccontinue_map")
        uccontinue_map = json.loads(raw_map) if raw_map else {}

    edits, next_uccontinue_map = fetch_global_contribs(username, uccontinue_map)

    return jsonify({
        "edits": edits,
        "next_uccontinue_map": next_uccontinue_map
    })


@app.route("/rollback_all", methods=["POST"])
def rollback_all():
    if "access_token" not in session:
        return jsonify({"success": False, "message": "Login required"})

    if not session.get("is_authorized"):
        return jsonify({"success": False, "message": "This tool is only for global rollbackers and stewards."})

    edits = request.json.get("edits", [])
    mark_as_bot = request.json.get("markbot", False)
    results = []

    for edit in edits:
        api = edit["wiki_api"]

        try:
            token_resp = oauth_request(api, params={
                "action": "query",
                "meta": "tokens",
                "type": "rollback",
                "format": "json"
            })

            if not token_resp:
                raise Exception("Token request failed")

            token_json = token_resp.json()
            token = token_json["query"]["tokens"]["rollbacktoken"]

            rollback_data = {
                "action": "rollback",
                "title": edit["title"],
                "user": edit["user"],
                "token": token,
                "format": "json"
            }
            if mark_as_bot:
                rollback_data["markbot"] = "1"

            r = oauth_request(api, method="POST", data=rollback_data)

            r_json = r.json()

            if "error" in r_json:
                status = "failed"
                error_msg = r_json["error"]
            else:
                status = "success"
                error_msg = None

        except Exception as e:
            status = "failed"
            error_msg = str(e)

        results.append({
            "revid": edit["revid"],
            "wiki": edit["wiki"],
            "title": edit["title"],
            "status": status,
            "error": error_msg
        })

        time.sleep(ROLLBACK_DELAY)

    return jsonify({"success": True, "results": results})


# ============================================================
# Run
# ============================================================

if __name__ == "__main__":
    app.run(debug=True)
