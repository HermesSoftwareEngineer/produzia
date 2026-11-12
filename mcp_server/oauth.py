"""Servidor de autorizacao OAuth 2.0 do MCP do Produzia.

Fluxo do spec MCP: o cliente (Claude no navegador, desktop ou celular) descobre o
servidor de autorizacao (RFC 9728 / RFC 8414), registra-se sozinho (RFC 7591) e o
dono da conta autoriza na pagina /oauth/login com o usuario e a senha do Produzia.
Codigo de autorizacao com PKCE (S256), access token de 24 h e refresh token de 90 dias
com rotacao.

Clientes e tokens ficam em SQLite (sobrevivem a restart e deploy, senao o conector
do claude.ai perderia o client_id registrado). Os tokens sao guardados so como hash.
O token fixo MCP_TOKEN continua aceito, para clientes configurados com header
(ex.: `claude mcp add --header`).
"""
import hashlib
import hmac
import html
import json
import secrets
import sqlite3
import threading
import time
from pathlib import Path

from pydantic import AnyHttpUrl
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    OAuthAuthorizationServerProvider,
    RefreshToken,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

SCOPE = "produzia"
ACCESS_TTL = 24 * 3600
REFRESH_TTL = 90 * 24 * 3600
CODE_TTL = 300
PENDING_TTL = 900

SCHEMA = """
CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id  TEXT PRIMARY KEY,
    info       TEXT NOT NULL,
    criado_em  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
    hash        TEXT PRIMARY KEY,
    tipo        TEXT NOT NULL,          -- access | refresh
    client_id   TEXT NOT NULL,
    scopes      TEXT NOT NULL,
    resource    TEXT,
    expira_em   INTEGER NOT NULL,
    grant_id    TEXT NOT NULL           -- liga access e refresh da mesma autorizacao
);
CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON oauth_tokens (grant_id);
"""


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class LoginLimiter:
    """Bloqueia o IP por 10 minutos depois de 8 senhas erradas."""

    def __init__(self, limit=8, window=600):
        self.limit, self.window = limit, window
        self.fails: dict[str, list[float]] = {}
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


class ProduziaOAuthProvider(OAuthAuthorizationServerProvider[AuthorizationCode, RefreshToken, AccessToken]):
    def __init__(self, public_url: str, db_path: str, user: str, password: str, static_token: str = ""):
        self.public_url = public_url.rstrip("/")
        self.user = user or ""
        self.password = password or ""
        self.static_token = static_token or ""
        self.limiter = LoginLimiter()
        self.codes: dict[str, AuthorizationCode] = {}
        self.pending: dict[str, dict] = {}  # id do pedido -> dados do /authorize
        self.lock = threading.Lock()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db_path = db_path
        with self._db() as conn:
            conn.executescript(SCHEMA)

    def _db(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    # --- Clientes (registro dinamico) -------------------------------------

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        with self._db() as conn:
            row = conn.execute("SELECT info FROM oauth_clients WHERE client_id = ?", (client_id,)).fetchone()
        return OAuthClientInformationFull.model_validate_json(row["info"]) if row else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        if not client_info.client_id:
            raise ValueError("client_id ausente")
        with self._db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO oauth_clients (client_id, info, criado_em) VALUES (?, ?, ?)",
                (client_info.client_id, client_info.model_dump_json(), int(time.time())),
            )

    # --- Autorizacao ------------------------------------------------------

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        """Guarda o pedido e manda o usuario para a pagina de login do Produzia."""
        request_id = secrets.token_urlsafe(24)
        with self.lock:
            now = time.time()
            for key in [k for k, v in self.pending.items() if v["expira_em"] < now]:
                del self.pending[key]
            self.pending[request_id] = {
                "client_id": client.client_id,
                "client_name": client.client_name or "Um aplicativo",
                "redirect_uri": str(params.redirect_uri),
                "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
                "code_challenge": params.code_challenge,
                "state": params.state,
                "scopes": params.scopes or [SCOPE],
                "resource": params.resource,
                "expira_em": now + PENDING_TTL,
            }
        return f"{self.public_url}/oauth/login?pedido={request_id}"

    def _pending(self, request_id):
        with self.lock:
            data = self.pending.get(request_id or "")
        if not data or data["expira_em"] < time.time():
            return None
        return data

    async def login_page(self, request: Request) -> Response:
        data = self._pending(request.query_params.get("pedido"))
        if not data:
            return _page(_expired())
        return _page(_form(request.query_params["pedido"], data["client_name"]))

    async def login_submit(self, request: Request) -> Response:
        form = await request.form()
        request_id = str(form.get("pedido") or "")
        data = self._pending(request_id)
        if not data:
            return _page(_expired(), status=400)

        ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
        if self.limiter.blocked(ip):
            return _page(_form(request_id, data["client_name"], "Muitas tentativas. Espere alguns minutos."), status=429)

        if form.get("acao") == "negar":
            with self.lock:
                self.pending.pop(request_id, None)
            return RedirectResponse(construct_redirect_uri(
                data["redirect_uri"], error="access_denied", state=data["state"]), status_code=302)

        user = str(form.get("usuario") or "")
        password = str(form.get("senha") or "")
        ok = (bool(self.password)
              and hmac.compare_digest(user.encode(), self.user.encode())
              and hmac.compare_digest(password.encode(), self.password.encode()))
        if not ok:
            self.limiter.fail(ip)
            return _page(_form(request_id, data["client_name"], "Usuário ou senha incorretos."), status=401)
        self.limiter.reset(ip)

        code = f"pzc_{secrets.token_urlsafe(32)}"
        with self.lock:
            self.pending.pop(request_id, None)
            self.codes[code] = AuthorizationCode(
                code=code,
                client_id=data["client_id"],
                redirect_uri=AnyHttpUrl(data["redirect_uri"]),
                redirect_uri_provided_explicitly=data["redirect_uri_provided_explicitly"],
                expires_at=time.time() + CODE_TTL,
                scopes=data["scopes"],
                code_challenge=data["code_challenge"],
                resource=data["resource"],
            )
        return RedirectResponse(construct_redirect_uri(data["redirect_uri"], code=code, state=data["state"]),
                                status_code=302)

    # --- Codigo -> tokens --------------------------------------------------

    async def load_authorization_code(self, client: OAuthClientInformationFull, authorization_code: str):
        with self.lock:
            code = self.codes.get(authorization_code)
        if code and code.client_id == client.client_id and code.expires_at > time.time():
            return code
        return None

    async def exchange_authorization_code(self, client, authorization_code: AuthorizationCode) -> OAuthToken:
        with self.lock:
            if self.codes.pop(authorization_code.code, None) is None:
                raise TokenError("invalid_grant", "Código de autorização já usado ou inválido.")
        return self._issue(client.client_id, authorization_code.scopes, authorization_code.resource)

    def _issue(self, client_id, scopes, resource, grant_id=None) -> OAuthToken:
        grant_id = grant_id or secrets.token_hex(16)
        access = f"pza_{secrets.token_urlsafe(32)}"
        refresh = f"pzr_{secrets.token_urlsafe(32)}"
        now = int(time.time())
        rows = [
            (_hash(access), "access", client_id, json.dumps(scopes), resource, now + ACCESS_TTL, grant_id),
            (_hash(refresh), "refresh", client_id, json.dumps(scopes), resource, now + REFRESH_TTL, grant_id),
        ]
        with self._db() as conn:
            conn.execute("DELETE FROM oauth_tokens WHERE expira_em < ?", (now,))
            conn.executemany("INSERT INTO oauth_tokens VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
        return OAuthToken(access_token=access, token_type="Bearer", expires_in=ACCESS_TTL,
                          scope=" ".join(scopes), refresh_token=refresh)

    def _row(self, token, tipo):
        with self._db() as conn:
            row = conn.execute("SELECT * FROM oauth_tokens WHERE hash = ? AND tipo = ?",
                               (_hash(token), tipo)).fetchone()
        if not row or row["expira_em"] < time.time():
            return None
        return row

    async def load_access_token(self, token: str) -> AccessToken | None:
        if self.static_token and hmac.compare_digest(token.encode(), self.static_token.encode()):
            return AccessToken(token=token, client_id="token-fixo", scopes=[SCOPE], expires_at=None)
        row = self._row(token, "access")
        if not row:
            return None
        return AccessToken(token=token, client_id=row["client_id"], scopes=json.loads(row["scopes"]),
                           expires_at=row["expira_em"], resource=row["resource"])

    async def load_refresh_token(self, client: OAuthClientInformationFull, refresh_token: str):
        row = self._row(refresh_token, "refresh")
        if not row or row["client_id"] != client.client_id:
            return None
        return RefreshToken(token=refresh_token, client_id=row["client_id"],
                            scopes=json.loads(row["scopes"]), expires_at=row["expira_em"])

    async def exchange_refresh_token(self, client, refresh_token: RefreshToken, scopes: list[str]) -> OAuthToken:
        row = self._row(refresh_token.token, "refresh")
        if not row:
            raise TokenError("invalid_grant", "Refresh token inválido ou expirado.")
        # Rotacao: a autorizacao antiga (access + refresh) deixa de valer.
        with self._db() as conn:
            conn.execute("DELETE FROM oauth_tokens WHERE grant_id = ?", (row["grant_id"],))
        return self._issue(client.client_id, scopes or json.loads(row["scopes"]), row["resource"])

    async def revoke_token(self, token) -> None:  # AccessToken | RefreshToken
        value = token.token if hasattr(token, "token") else str(token)
        with self._db() as conn:
            row = conn.execute("SELECT grant_id FROM oauth_tokens WHERE hash = ?", (_hash(value),)).fetchone()
            if row:
                conn.execute("DELETE FROM oauth_tokens WHERE grant_id = ?", (row["grant_id"],))


# --- Pagina de login (HTML puro, no visual do Produzia) ----------------------

CSS = """
:root { color-scheme: light dark; --bg:#f4f6f9; --surface:#fff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0;
  --brand:#0f766e; --brand-hover:#115e59; --bad:#dc2626; --soft:#f1f5f9; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1114; --surface:#121a1f; --ink:#e6edf0; --muted:#8b9aa3;
  --line:#24323a; --brand:#14b8a6; --brand-hover:#0d9488; --bad:#f87171; --soft:#1c2830; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; padding:16px; background:var(--bg);
  font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; color:var(--ink); font-size:14px; }
.card { width:100%; max-width:400px; background:var(--surface); border:1px solid var(--line); border-radius:16px;
  padding:32px; box-shadow:0 20px 50px rgb(15 23 42 / .08); display:flex; flex-direction:column; gap:14px; }
.brand { display:flex; align-items:center; gap:10px; font-weight:700; font-size:20px; }
.mark { width:32px; height:32px; border-radius:9px; background:linear-gradient(135deg,#14b8a6,#0f766e);
  display:grid; place-items:center; }
.mark svg { width:18px; height:18px; fill:#fff; }
p { margin:0; color:var(--muted); line-height:1.5; }
p b { color:var(--ink); }
.perms { margin:0; padding:12px 14px; background:var(--soft); border-radius:10px; list-style:none; display:grid; gap:6px;
  color:var(--ink); font-size:13px; }
.perms li::before { content:'\\2713'; color:var(--brand); font-weight:700; margin-right:8px; }
label { display:flex; flex-direction:column; gap:6px; font-weight:500; font-size:13px; }
input { height:40px; border:1px solid var(--line); border-radius:8px; padding:0 12px; font:inherit; color:var(--ink);
  background:var(--surface); }
input:focus { outline:2px solid color-mix(in srgb, var(--brand) 40%, transparent); border-color:var(--brand); }
.err { color:var(--bad); font-weight:500; }
.row { display:flex; gap:10px; margin-top:4px; }
button { flex:1; height:40px; border-radius:8px; font:inherit; font-weight:600; cursor:pointer; border:1px solid var(--line);
  background:var(--surface); color:var(--ink); }
button.primary { background:var(--brand); border-color:var(--brand); color:#fff; flex:2; }
button.primary:hover { background:var(--brand-hover); }
small { color:var(--muted); font-size:12px; text-align:center; }
"""

LOGO = '<span class="mark"><svg viewBox="0 0 24 24"><path d="M5 13h3v7H5zm5.5-5h3v12h-3zM16 4h3v16h-3z"/></svg></span>'


def _page(body: str, status: int = 200) -> HTMLResponse:
    doc = (
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>Autorizar acesso · Produzia</title>'
        '<link rel="preconnect" href="https://fonts.googleapis.com">'
        '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">'
        f"<style>{CSS}</style></head><body>{body}</body></html>"
    )
    return HTMLResponse(doc, status_code=status, headers={
        "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer"})


def _form(request_id: str, client_name: str, error: str | None = None) -> str:
    name = html.escape(client_name)
    err = f'<p class="err">{html.escape(error)}</p>' if error else ""
    return f"""
<form class="card" method="post" action="/oauth/login">
  <div class="brand">{LOGO}Produzia</div>
  <p><b>{name}</b> quer acessar o Produzia em seu nome.</p>
  <ul class="perms">
    <li>Ver quadros, resumo do dia e dashboard</li>
    <li>Criar, editar e excluir processos mapeados</li>
  </ul>
  <input type="hidden" name="pedido" value="{html.escape(request_id)}">
  <label>Usuário<input name="usuario" autocomplete="username" required autofocus></label>
  <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
  {err}
  <div class="row">
    <button type="submit" name="acao" value="negar" formnovalidate>Negar</button>
    <button type="submit" name="acao" value="autorizar" class="primary">Autorizar</button>
  </div>
  <small>Use o mesmo usuário e senha do painel do Produzia.</small>
</form>"""


def _expired() -> str:
    return f"""
<div class="card">
  <div class="brand">{LOGO}Produzia</div>
  <p>Este pedido de autorização expirou ou já foi usado. Volte ao aplicativo e tente conectar de novo.</p>
</div>"""
