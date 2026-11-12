"""Fluxo OAuth 2.0 do servidor MCP, do jeito que o claude.ai faz: descoberta, registro
dinamico, autorizacao com PKCE no login do Produzia, troca de codigo, uso e refresh."""
import base64
import hashlib
import secrets
from urllib.parse import parse_qs, urlparse

import pytest

pytest.importorskip("mcp")
from starlette.testclient import TestClient  # noqa: E402

from mcp_server import server  # noqa: E402
from test_mcp_server import KEY, TOKEN, FlaskTransport, flask_app, sse  # noqa: E402,F401

BASE = "https://produzia.olimpo-services.com.br"
REDIRECT = "https://claude.ai/api/mcp/auth_callback"
ACCEPT = {"Accept": "application/json, text/event-stream"}
INIT = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "teste", "version": "1"}}}


def make_client(flask_app, tmp_path):
    env = {"PRODUZIA_API_URL": "http://produzia/api", "PRODUZIA_API_KEY": KEY, "MCP_TOKEN": TOKEN,
           "PUBLIC_URL": BASE, "OAUTH_DB_PATH": str(tmp_path / "oauth.sqlite3"),
           "APP_USER": "admin", "APP_PASSWORD": "senha"}
    asgi = server.create_app(env, transport=FlaskTransport(flask_app.test_client()))
    return TestClient(asgi, base_url=BASE, follow_redirects=False)


def pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def register(tc):
    r = tc.post("/register", json={"client_name": "Claude", "redirect_uris": [REDIRECT],
                                   "grant_types": ["authorization_code", "refresh_token"],
                                   "response_types": ["code"], "token_endpoint_auth_method": "none"})
    assert r.status_code == 201, r.text
    return r.json()["client_id"]


def authorize(tc, client_id, challenge, senha="senha"):
    r = tc.get("/authorize", params={
        "response_type": "code", "client_id": client_id, "redirect_uri": REDIRECT, "state": "xyz",
        "code_challenge": challenge, "code_challenge_method": "S256", "scope": "produzia",
        "resource": f"{BASE}/mcp"})
    assert r.status_code == 302, r.text
    login = urlparse(r.headers["location"])
    assert login.path == "/oauth/login"
    pedido = parse_qs(login.query)["pedido"][0]
    page = tc.get(f"/oauth/login?pedido={pedido}")
    assert page.status_code == 200 and "Claude" in page.text and "quer acessar o Produzia" in page.text
    return tc.post("/oauth/login", data={"pedido": pedido, "usuario": "admin", "senha": senha, "acao": "autorizar"})


def tokens_via_code(tc, client_id):
    verifier, challenge = pkce()
    r = authorize(tc, client_id, challenge)
    assert r.status_code == 302
    back = urlparse(r.headers["location"])
    params = parse_qs(back.query)
    assert f"{back.scheme}://{back.netloc}{back.path}" == REDIRECT and params["state"] == ["xyz"]
    r = tc.post("/token", data={"grant_type": "authorization_code", "code": params["code"][0],
                                "redirect_uri": REDIRECT, "client_id": client_id, "code_verifier": verifier})
    assert r.status_code == 200, r.text
    return r.json()


def test_discovery_metadata(flask_app, tmp_path):
    with make_client(flask_app, tmp_path) as tc:
        r = tc.post("/mcp", json=INIT, headers=ACCEPT)
        assert r.status_code == 401
        assert "oauth-protected-resource" in r.headers["www-authenticate"]

        res = tc.get("/.well-known/oauth-protected-resource/mcp").json()
        assert res["resource"] == f"{BASE}/mcp" and res["authorization_servers"] == [f"{BASE}/"]

        meta = tc.get("/.well-known/oauth-authorization-server").json()
        assert meta["authorization_endpoint"] == f"{BASE}/authorize"
        assert meta["token_endpoint"] == f"{BASE}/token"
        assert meta["registration_endpoint"] == f"{BASE}/register"
        assert "S256" in meta["code_challenge_methods_supported"]
        assert tc.get("/health").json() == {"status": "ok"}


def test_full_oauth_flow_and_refresh(flask_app, tmp_path):
    with make_client(flask_app, tmp_path) as tc:
        client_id = register(tc)
        tok = tokens_via_code(tc, client_id)
        assert tok["token_type"].lower() == "bearer" and tok["refresh_token"]

        auth = {**ACCEPT, "Authorization": f"Bearer {tok['access_token']}"}
        r = tc.post("/mcp", json=INIT, headers=auth)
        assert r.status_code == 200 and sse(r)["result"]["serverInfo"]["name"] == "produzia"
        r = tc.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                                  "params": {"name": "listar_quadros", "arguments": {}}}, headers=auth)
        assert "Obras" in r.text

        # Refresh com rotacao: o par antigo para de valer
        r = tc.post("/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"],
                                    "client_id": client_id})
        assert r.status_code == 200, r.text
        novo = r.json()
        assert tc.post("/mcp", json=INIT, headers=auth).status_code == 401
        assert tc.post("/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"],
                                       "client_id": client_id}).status_code == 400
        auth2 = {**ACCEPT, "Authorization": f"Bearer {novo['access_token']}"}
        assert tc.post("/mcp", json=INIT, headers=auth2).status_code == 200

    # Clientes e tokens sobrevivem a um restart (novo app, mesmo banco)
    with make_client(flask_app, tmp_path) as tc:
        assert tc.post("/mcp", json=INIT, headers=auth2).status_code == 200
        tokens_via_code(tc, client_id)


def test_code_is_single_use_and_needs_pkce(flask_app, tmp_path):
    with make_client(flask_app, tmp_path) as tc:
        client_id = register(tc)
        verifier, challenge = pkce()
        code = parse_qs(urlparse(authorize(tc, client_id, challenge).headers["location"]).query)["code"][0]
        bad = tc.post("/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT,
                                      "client_id": client_id, "code_verifier": "errado" * 8})
        assert bad.status_code == 400
        data = {"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT,
                "client_id": client_id, "code_verifier": verifier}
        assert tc.post("/token", data=data).status_code == 200
        assert tc.post("/token", data=data).status_code == 400


def test_wrong_password_and_deny(flask_app, tmp_path):
    with make_client(flask_app, tmp_path) as tc:
        client_id = register(tc)
        _, challenge = pkce()
        r = authorize(tc, client_id, challenge, senha="errada")
        assert r.status_code == 401 and "incorretos" in r.text

        r = tc.get("/authorize", params={
            "response_type": "code", "client_id": client_id, "redirect_uri": REDIRECT, "state": "s1",
            "code_challenge": challenge, "code_challenge_method": "S256"})
        pedido = parse_qs(urlparse(r.headers["location"]).query)["pedido"][0]
        r = tc.post("/oauth/login", data={"pedido": pedido, "acao": "negar"})
        assert r.status_code == 302 and "error=access_denied" in r.headers["location"]
        assert tc.post("/oauth/login", data={"pedido": pedido, "acao": "autorizar"}).status_code == 400


def test_static_token_still_works(flask_app, tmp_path):
    with make_client(flask_app, tmp_path) as tc:
        r = tc.post("/mcp", json=INIT, headers={**ACCEPT, "Authorization": f"Bearer {TOKEN}"})
        assert r.status_code == 200
        assert tc.post("/mcp", json=INIT, headers={**ACCEPT, "Authorization": "Bearer errado"}).status_code == 401
