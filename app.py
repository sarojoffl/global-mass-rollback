# -*- coding: utf-8 -*-

from flask import Flask, render_template, request, jsonify, session, redirect
import requests
import mwoauth
from requests_oauthlib import OAuth1
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import time
import os

app = Flask(__name__)

# ---------------- Config ----------------
SECRET_KEY = os.environ.get("SECRET_KEY")
CONSUMER_KEY = os.environ.get("CONSUMER_KEY")
CONSUMER_SECRET = os.environ.get("CONSUMER_SECRET")
OAUTH_MWURI = os.environ.get(
    "OAUTH_MWURI",
    "https://meta.wikimedia.org/w/index.php"
)

if not SECRET_KEY or not CONSUMER_KEY or not CONSUMER_SECRET:
    raise RuntimeError("Missing required environment variables")
    
app.secret_key = SECRET_KEY

# ---------------- Requests session ----------------
session_requests = requests.Session()
session_requests.headers.update({
    "User-Agent": "GlobalMassRollback/1.0 (https://meta.wikimedia.org/wiki/User:Saroj)"
})

# ---------------- Settings ----------------
GLOBAL_EDIT_LIMIT = 50
MAX_WORKERS = 10
ROLLBACK_DELAY = 0.5

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

    method = method.upper()
    if method == "POST":
        return requests.post(url, auth=auth, data=data, params=params, headers=session_requests.headers)
    else:
        return requests.get(url, auth=auth, params=params, headers=session_requests.headers)


# ============================================================
# Global Contributions
# ============================================================

def get_latest_revision(api_url, title):
    try:
        resp = session_requests.get(api_url, params={
            "action": "query",
            "titles": title,
            "prop": "revisions",
            "rvprop": "ids",
            "format": "json"
        }).json()
        pages = resp["query"]["pages"]
        for page in pages.values():
            if "revisions" in page:
                return page["revisions"][0]["revid"]
    except:
        pass
    return None


def fetch_global_contribs(username):
    meta_url = "https://meta.wikimedia.org/w/api.php"
    resp = session_requests.get(meta_url, params={
        "action": "query",
        "meta": "globaluserinfo",
        "guiuser": username,
        "guiprop": "merged",
        "format": "json"
    }).json()

    merged = resp["query"]["globaluserinfo"]["merged"]
    wiki_api_map = {w["wiki"]: w["url"] + "/w/api.php" for w in merged if w["editcount"] > 0}

    rollbackable = []
    lock = threading.Lock()

    def worker(wiki, api_url):
        try:
            resp = session_requests.get(api_url, params={
                "action": "query",
                "list": "usercontribs",
                "ucuser": username,
                "uclimit": 100,
                "ucprop": "title|ids|timestamp|user|comment|sizediff",
                "format": "json"
            }).json()
            for edit in resp["query"]["usercontribs"]:
                latest = get_latest_revision(api_url, edit["title"])
                if latest == edit["revid"]:
                    edit["wiki"] = wiki
                    edit["wiki_api"] = api_url
                    with lock:
                        if len(rollbackable) < GLOBAL_EDIT_LIMIT:
                            rollbackable.append(edit)
        except Exception as e:
            print("Worker error:", e)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(worker, wiki, api) for wiki, api in wiki_api_map.items()]
        for f in as_completed(futures):
            pass

    rollbackable.sort(key=lambda x: x["timestamp"], reverse=True)
    return rollbackable[:GLOBAL_EDIT_LIMIT]


# ============================================================
# Routes
# ============================================================

@app.route("/")
def index():
    return render_template(
        "index.html",
        logged_in="access_token" in session,
        username=session.get("username")
    )


@app.route("/get_global_contribs", methods=["POST"])
def get_global_contribs_route():
    if "access_token" not in session:
        return jsonify([])

    username = request.form.get("username")
    edits = fetch_global_contribs(username)
    return jsonify(edits)


@app.route("/rollback_all", methods=["POST"])
def rollback_all():
    if "access_token" not in session:
        return jsonify({"success": False, "message": "Login required"})

    edits = request.json.get("edits", [])
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
            token_json = token_resp.json()
            token = token_json["query"]["tokens"]["rollbacktoken"]

            r = oauth_request(api, method="POST", data={
                "action": "rollback",
                "title": edit["title"],
                "user": edit["user"],
                "token": token,
                "format": "json"
            })

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
