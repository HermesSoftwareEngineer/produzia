import hmac
import os
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, request, send_from_directory, session

from . import db, metrics
from .trello import PowerUpClient, SourceError, TrelloClient

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
BOARD_REF = re.compile(r"trello\.com/b/([A-Za-z0-9]+)|^([A-Za-z0-9]{8}|[0-9a-f]{24})$")
DONE_NAMES = re.compile(r"conclu|feito|finaliz|done|entreg|pronto|encerr", re.I)
MAX_DAYS = 90


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class LoginLimiter:
    """Bloqueia o IP por alguns minutos depois de muitas senhas erradas."""

    def __init__(self, limit=8, window=600):
        self.limit, self.window = limit, window
        self.fails = {}
        self.lock = threading.Lock()

    def blocked(self, ip):
        now = time.monotonic()
        with self.lock:
            recent = [t for t in self.fails.get(ip, []) if now - t < self.window]
            self.fails[ip] = recent
            return len(recent) >= self.limit

    def fail(self, ip):
        with self.lock:
            self.fails.setdefault(ip, []).append(time.monotonic())

    def reset(self, ip):
        with self.lock:
            self.fails.pop(ip, None)


def create_app(overrides=None):
    app = Flask(__name__, static_folder=None)
    env = os.environ.get
    app.config.update(
        DATABASE_PATH=env("DATABASE_PATH", "data/produzia.sqlite3"),
        SECRET_KEY=env("SECRET_KEY") or secrets.token_hex(32),
        APP_USER=env("APP_USER", "admin"),
        APP_PASSWORD=env("APP_PASSWORD", ""),
        TIMEZONE=env("TIMEZONE", "America/Sao_Paulo"),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=env("COOKIE_SECURE", "1") == "1",
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
    )
    if overrides:
        app.config.update(overrides)
    app.json.ensure_ascii = False
    app.config.setdefault("TRELLO", TrelloClient(env("TRELLO_KEY", ""), env("TRELLO_TOKEN", "")))
    app.config.setdefault(
        "POWERUP", PowerUpClient(env("POWERUP_API_URL", ""), env("POWERUP_API_KEY", ""))
    )
    tz = ZoneInfo(app.config["TIMEZONE"])
    limiter = LoginLimiter()

    Path(app.config["DATABASE_PATH"]).parent.mkdir(parents=True, exist_ok=True)
    db.init_db(app.config["DATABASE_PATH"])
    app.teardown_appcontext(db.close_db)

    trello = app.config["TRELLO"]
    powerup = app.config["POWERUP"]

    @app.errorhandler(ApiError)
    def api_error(error):
        return jsonify(erro=error.message), error.status

    @app.errorhandler(SourceError)
    def source_error(error):
        return jsonify(erro=error.message), error.status

    def logged_in():
        return session.get("user") == app.config["APP_USER"]

    def api_login_required(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if not logged_in():
                return jsonify(erro="Faça login."), 401
            return view(*args, **kwargs)
        return wrapper

    # --- Paginas -------------------------------------------------------------

    @app.get("/health")
    def health():
        return jsonify(status="ok")

    @app.post("/api/login")
    def login():
        forwarded = request.headers.get("X-Forwarded-For", request.remote_addr or "")
        ip = forwarded.split(",")[0].strip()
        if limiter.blocked(ip):
            return jsonify(erro="Muitas tentativas. Espere alguns minutos."), 429
        body = request.get_json(silent=True) or {}
        user = str(body.get("usuario", ""))
        password = str(body.get("senha", ""))
        expected = app.config["APP_PASSWORD"]
        ok = (
            bool(expected)
            and hmac.compare_digest(user.encode(), app.config["APP_USER"].encode())
            and hmac.compare_digest(password.encode(), expected.encode())
        )
        if not ok:
            limiter.fail(ip)
            return jsonify(erro="Usuário ou senha incorretos."), 401
        limiter.reset(ip)
        session.clear()
        session.permanent = True
        session["user"] = app.config["APP_USER"]
        return jsonify(usuario=session["user"])

    @app.post("/api/logout")
    def logout():
        session.clear()
        return jsonify(ok=True)

    @app.get("/api/me")
    def me():
        if not logged_in():
            return jsonify(erro="Faça login."), 401
        return jsonify(usuario=session["user"])

    @app.get("/assets/<path:name>")
    def assets(name):
        response = send_from_directory(PUBLIC_DIR / "assets", name)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response

    @app.get("/favicon.svg")
    def favicon():
        return send_from_directory(PUBLIC_DIR, "favicon.svg")

    @app.get("/")
    @app.get("/login")
    @app.get("/resumo")
    @app.get("/quadros")
    def spa():
        response = send_from_directory(PUBLIC_DIR, "index.html")
        response.headers["Cache-Control"] = "no-cache"
        return response

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    # --- Quadros -------------------------------------------------------------

    @app.get("/api/boards")
    @api_login_required
    def boards_list():
        return jsonify(quadros=db.list_boards())

    @app.get("/api/trello/boards")
    @api_login_required
    def trello_boards():
        registered = {b["id"] for b in db.list_boards()}
        out = [
            {
                "id": b["id"], "nome": b["name"], "url": b["url"],
                "workspace": (b.get("organization") or {}).get("displayName"),
                "cadastrado": b["id"] in registered,
            }
            for b in trello.my_boards() if not b.get("closed")
        ]
        out.sort(key=lambda b: ((b["workspace"] or "~").lower(), b["nome"].lower()))
        return jsonify(quadros=out)

    @app.get("/api/boards/<board_id>/lists")
    @api_login_required
    def board_lists(board_id):
        lists = [
            {"id": l["id"], "nome": l["name"], "arquivada": l.get("closed", False)}
            for l in sorted(trello.lists(board_id), key=lambda l: l.get("pos", 0))
        ]
        return jsonify(listas=lists)

    @app.post("/api/boards")
    @api_login_required
    def board_create():
        body = request.get_json(silent=True) or {}
        ref = str(body.get("ref", "")).strip()
        match = BOARD_REF.search(ref)
        if not match:
            raise ApiError(400, "Informe o link do quadro (trello.com/b/...) ou o ID.")
        info = trello.board(match.group(1) or match.group(2))
        if db.get_board(info["id"]):
            raise ApiError(409, "Este quadro já está cadastrado.")
        lists = trello.lists(info["id"])
        done = [l["id"] for l in lists if not l.get("closed") and DONE_NAMES.search(l["name"])]
        db.save_board(info["id"], info["name"], info["url"], done)
        return jsonify(db.get_board(info["id"])), 201

    @app.put("/api/boards/<board_id>")
    @api_login_required
    def board_update(board_id):
        board = db.get_board(board_id)
        if not board:
            raise ApiError(404, "Quadro não cadastrado.")
        body = request.get_json(silent=True) or {}
        done = body.get("doneListIds")
        if not isinstance(done, list) or not all(isinstance(i, str) for i in done):
            raise ApiError(400, "Envie doneListIds como lista.")
        valid = {l["id"] for l in trello.lists(board_id)}
        db.save_board(board_id, board["nome"], board["url"], [i for i in done if i in valid])
        return jsonify(db.get_board(board_id))

    @app.delete("/api/boards/<board_id>")
    @api_login_required
    def board_delete(board_id):
        db.delete_board(board_id)
        return "", 204

    # --- Relatorios ----------------------------------------------------------

    def selected_boards():
        boards = db.list_boards()
        wanted = request.args.get("quadros")
        if wanted:
            ids = set(wanted.split(","))
            boards = [b for b in boards if b["id"] in ids]
        return boards

    def warnings(boards_data):
        return [w for bd in boards_data for w in bd.warnings]

    @app.post("/api/cache/clear")
    @api_login_required
    def cache_clear():
        trello.cache.clear()
        powerup.cache.clear()
        return jsonify(ok=True)

    @app.get("/api/resumo")
    @api_login_required
    def resumo():
        try:
            day = metrics.parse_day(request.args.get("data"), tz)
        except ValueError:
            raise ApiError(400, "Data inválida. Use AAAA-MM-DD.")
        start, end = metrics.day_bounds(day, tz)
        today = datetime.now(tz).date()
        ttl = 60 if day >= today else 600
        data = metrics.collect(selected_boards(), trello, powerup, start, end, actions_ttl=ttl)
        out = metrics.day_summary(data, day, tz)
        out["hoje"] = today.isoformat()
        out["avisos"] = warnings(data)
        return jsonify(out)

    @app.get("/api/dashboard")
    @api_login_required
    def dashboard():
        try:
            days = max(1, min(MAX_DAYS, int(request.args.get("dias", 14))))
        except ValueError:
            raise ApiError(400, "Período inválido.")
        today = datetime.now(tz).date()
        start, _ = metrics.day_bounds(today - timedelta(days=2 * days - 1), tz)
        # Fim no inicio do dia seguinte: a mesma chave de cache serve o dia todo.
        _, end = metrics.day_bounds(today, tz)
        data = metrics.collect(selected_boards(), trello, powerup, start, end, actions_ttl=180)
        out = metrics.dashboard(data, today, days, tz)
        out["avisos"] = warnings(data)
        out["atualizadoEm"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        return jsonify(out)

    return app
