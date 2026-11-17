import hashlib
import os
import re
import time
import tomllib

import mwoauth
from flask import Flask, abort, jsonify, redirect, render_template, request, send_from_directory, session, url_for
from requests_oauthlib import OAuth1
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

import usage
import wiki

# layout based on gs-steward-stats (https://github.com/MadMaxWP/gs-steward-stats)

here = os.path.dirname(os.path.abspath(__file__))

# config.toml for local runs, envvars on toolforge
conf = {}
if os.path.exists(os.path.join(here, "config.toml")):
    with open(os.path.join(here, "config.toml"), "rb") as f:
        conf = tomllib.load(f)


def setting(name, env, default=None):
    return conf.get(name) or conf.get(name.upper()) or os.environ.get(env) or default


secret_key = setting("secret_key", "SECRET_KEY")
consumer_key = setting("consumer_key", "CONSUMER_KEY")
consumer_secret = setting("consumer_secret", "CONSUMER_SECRET")
oauth_mwuri = setting("oauth_mwuri", "OAUTH_MWURI", "https://meta.wikimedia.org/w/index.php")
source_url = os.environ.get("GMR_SOURCE_URL", "https://github.com/sarojoffl/global-mass-rollback")

cdn = os.environ.get("GMR_CDN", "https://tools-static.wmflabs.org/cdnjs/ajax/libs")
assets = {
    "vue": os.environ.get("GMR_VUE_URL", cdn + "/vue/3.5.44/vue.esm-browser.prod.min.js"),
    "codex": os.environ.get("GMR_CODEX_URL", cdn + "/codex/2.7.0/codex.min.js"),
    "icons": os.environ.get("GMR_ICONS_URL", cdn + "/codex-icons/2.7.0/codex-icons.min.js"),
    "codex_css": os.environ.get("GMR_CODEX_CSS", cdn + "/codex/2.7.0/codex.style.css"),
    "tokens": os.environ.get("GMR_TOKENS_CSS", cdn + "/codex-design-tokens/2.7.0/theme-wikimedia-ui.css"),
    "dark": os.environ.get("GMR_DARK_CSS", cdn + "/codex-design-tokens/2.7.0/theme-wikimedia-ui-mode-dark.css"),
    "logo": "https://upload.wikimedia.org/wikipedia/commons/6/6c/Meta-Wiki_Global_rollback.svg",
}

app = Flask(__name__, static_folder=None)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config.update(
    SECRET_KEY=secret_key,
    # GMR_LOCAL=1 for plain http on your own machine
    SESSION_COOKIE_SECURE=os.environ.get("GMR_LOCAL") != "1",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)


def git_commit():
    found = (os.environ.get("GMR_COMMIT") or "").strip()
    if not found:
        try:
            with open(os.path.join(here, ".git", "HEAD")) as f:
                head = f.read().strip()
            if head.startswith("ref: "):
                with open(os.path.join(here, ".git", head[5:])) as f:
                    head = f.read().strip()
            found = head
        except OSError:
            pass
    return found if re.fullmatch(r"[0-9a-f]{7,40}", found) else ""


def asset_version():
    # changes when js or css does, so browsers don't keep old files
    h = hashlib.sha1()
    for top in ("js", "css"):
        for root, dirs, files in os.walk(os.path.join(here, top)):
            dirs.sort()
            for name in sorted(files):
                with open(os.path.join(root, name), "rb") as f:
                    h.update(f.read())
    return h.hexdigest()[:10]


commit = git_commit()
version = asset_version()


def page(template, **extra):
    html = render_template(template, assets=assets, v=version, source=source_url, commit=commit, **extra)
    return html, 200, {"Cache-Control": "private, no-store"}


def oauth_ready():
    return bool(secret_key and consumer_key and consumer_secret)


def consumer():
    return mwoauth.ConsumerToken(consumer_key, consumer_secret)


def me():
    return session.get("username")


# pages and files

@app.route("/")
def index():
    return page("index.html")


@app.route("/js/<path:name>")
def js(name):
    return send_from_directory(os.path.join(here, "js"), name)


@app.route("/css/<path:name>")
def css(name):
    return send_from_directory(os.path.join(here, "css"), name)


@app.route("/healthz")
def healthz():
    return "ok", 200, {"Content-Type": "text/plain", "Cache-Control": "no-store"}


# login

@app.route("/login")
def login():
    if not oauth_ready():
        return "Login is not configured.", 503
    try:
        target, request_token = mwoauth.initiate(oauth_mwuri, consumer())
    except Exception:
        app.logger.exception("oauth initiate failed")
        return redirect(url_for("index"))
    session["request_token"] = dict(zip(request_token._fields, request_token))
    return redirect(target)


# the consumer is registered with this url, keep it
@app.route("/oauth/callback")
def oauth_callback():
    if not oauth_ready() or "request_token" not in session:
        return redirect(url_for("index"))
    try:
        access = mwoauth.complete(oauth_mwuri, consumer(), mwoauth.RequestToken(**session.pop("request_token")), request.query_string)
        identity = mwoauth.identify(oauth_mwuri, consumer(), access)
    except Exception:
        app.logger.exception("oauth callback failed")
        return redirect(url_for("index"))
    session.clear()
    session["username"] = identity["username"]
    session["access"] = {"key": access.key, "secret": access.secret}
    session["authorized"] = wiki.is_authorized(identity["username"])
    usage.seen(identity["username"], force=True)
    return redirect(url_for("index"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


public = {"login", "oauth_callback", "logout", "js", "css", "healthz"}


@app.before_request
def require_login():
    if request.endpoint in public:
        return None
    if me():
        if request.path.startswith("/api/"):
            usage.seen(me())
        return None
    if request.path.startswith("/api/"):
        return jsonify({"error": "Login required."}), 401
    return page("login.html", login_url=url_for("login"), login_enabled=oauth_ready())


# api

def need_rights():
    if not session.get("authorized"):
        abort(403, "This tool is only for global rollbackers, stewards and global sysops.")


def body():
    # json only, so other sites can't post forms here
    if not request.is_json:
        abort(415, "Expected JSON.")
    return request.get_json(silent=True) or {}


def clean_filters(raw):
    raw = raw if isinstance(raw, dict) else {}
    date = lambda v: v if isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v) else None

    def num(v):
        try:
            return int(v) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None

    ns = raw.get("namespace")
    return {
        "wikis": [w for w in raw.get("wikis", []) if isinstance(w, str) and re.fullmatch(r"[a-z0-9_]+", w)][:300],
        "comment": str(raw.get("comment") or "").strip()[:200],
        "title": str(raw.get("title") or "").strip()[:200],
        "tag": str(raw.get("tag") or "").strip()[:100],
        "namespace": str(ns) if ns not in (None, "") and re.fullmatch(r"-?\d+", str(ns)) else None,
        "kind": raw.get("kind") if raw.get("kind") in ("new", "existing") else None,
        "from": date(raw.get("from")),
        "to": date(raw.get("to")),
        "min_size": num(raw.get("min_size")),
        "max_size": num(raw.get("max_size")),
    }


@app.route("/api/me")
def api_me():
    return jsonify({"username": me(), "authorized": bool(session.get("authorized"))})


@app.route("/api/wikis")
def api_wikis():
    return jsonify({"wikis": wiki.all_wikis()})


@app.route("/api/contribs", methods=["POST"])
def api_contribs():
    need_rights()
    b = body()
    username = str(b.get("username") or "").strip().replace("_", " ")
    if not username:
        abort(400, "Enter a username.")
    try:
        limit = max(1, min(int(b.get("limit") or 50), 500))
    except (TypeError, ValueError):
        limit = 50
    conts = b.get("next") if isinstance(b.get("next"), dict) else None
    try:
        found = wiki.contribs(username, clean_filters(b.get("filters")), limit, conts)
    except Exception as e:
        app.logger.warning("contribs failed: %s", e)
        abort(502, "Could not reach Wikimedia, please try again.")
    if found is None:
        abort(404, f"There is no global account named {username}.")
    return jsonify(found)


@app.route("/api/rollback", methods=["POST"])
def api_rollback():
    need_rights()
    b = body()
    edit = b.get("edit") or {}
    if not edit.get("title") or not edit.get("user"):
        abort(400, "Bad edit.")
    api = wiki.api_for(edit.get("wiki"))
    if not api:
        abort(400, "Unknown or closed project.")
    edit = {**edit, "wiki_api": api}
    markbot = bool(b.get("markbot"))
    summary = str(b.get("summary") or "").strip()[:500]
    auth = OAuth1(consumer_key, consumer_secret, session["access"]["key"], session["access"]["secret"])
    try:
        ok, code, info = wiki.rollback(edit, me(), auth, markbot, summary)
    except Exception as e:
        ok, code, info = False, "request-failed", str(e)
    usage.rolled_back(me(), ok)
    time.sleep(0.5)  # go easy on the wikis
    return jsonify({"ok": ok, "code": code, "info": info})


@app.route("/api/stats")
def api_stats():
    return jsonify(usage.summary())


@app.errorhandler(Exception)
def on_error(e):
    api = request.path.startswith("/api/")
    if isinstance(e, HTTPException):
        return (jsonify({"error": e.description}), e.code) if api else e
    app.logger.exception("error on %s", request.path)
    msg = "Something went wrong on the server. Please try again."
    return (jsonify({"error": msg}), 500) if api else (msg, 500)


if __name__ == "__main__":
    app.run(debug=True)
