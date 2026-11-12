"""Ferramentas do servidor MCP contra o app Flask de verdade (via transporte httpx em memoria)."""
import asyncio
import json

import pytest

pytest.importorskip("mcp")
import httpx  # noqa: E402
from mcp.server.fastmcp.exceptions import ToolError  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

from app import create_app  # noqa: E402
from mcp_server import server  # noqa: E402
from test_app import BOARD, FakePowerUp, FakeTrello  # noqa: E402

KEY = "chave"
TOKEN = "token-mcp"
FLOW = "flowchart TD\n  A[Início] --> B[Fim]\n"


class FlaskTransport(httpx.AsyncBaseTransport):
    """Entrega as requisicoes do httpx ao test client do Flask."""

    def __init__(self, flask_client):
        self.client = flask_client

    async def handle_async_request(self, request):
        resp = self.client.open(
            request.url.raw_path.decode(), method=request.method,
            headers=[(k, v) for k, v in request.headers.items() if k.lower() != "host"],
            data=request.content,
        )
        return httpx.Response(resp.status_code, headers=list(resp.headers.items()), content=resp.data)


@pytest.fixture
def flask_app(tmp_path):
    app = create_app({
        "TESTING": True, "DATABASE_PATH": str(tmp_path / "m.sqlite3"), "APP_USER": "admin",
        "APP_PASSWORD": "senha", "SECRET_KEY": "x", "TRELLO": FakeTrello(), "POWERUP": FakePowerUp(),
        "SESSION_COOKIE_SECURE": False, "PRODUZIA_API_KEY": KEY,
    })
    c = app.test_client()
    c.post("/api/login", json={"usuario": "admin", "senha": "senha"})
    assert c.post("/api/boards", json={"ref": BOARD}).status_code == 201
    return app


def make_mcp(flask_app, key=KEY):
    api = server.ProduziaAPI("http://produzia/api", key, transport=FlaskTransport(flask_app.test_client()))
    return server.build_server(api)


def call(mcp, name, **args):
    result = asyncio.run(mcp.call_tool(name, args))
    if isinstance(result, tuple):  # (conteudo, estruturado)
        return result[1].get("result", result[1])
    return json.loads(result[0].text)


def test_process_tools_roundtrip(flask_app):
    mcp = make_mcp(flask_app)
    assert call(mcp, "listar_quadros")["quadros"][0]["id"] == BOARD

    p = call(mcp, "criar_processo", quadro_id=BOARD, nome="Onboarding", categoria="RH",
             fluxograma_mermaid=FLOW)
    assert p["atualizadoPor"] == "mcp" and p["fluxograma"] == FLOW

    up = call(mcp, "atualizar_processo", processo_id=p["id"], markdown="# Passos\n\n| a | b |\n|---|---|")
    assert up["temDocumento"] and up["categoria"] == "RH"

    assert [x["id"] for x in call(mcp, "listar_processos", quadro_id=BOARD)["processos"]] == [p["id"]]
    assert call(mcp, "obter_processo", processo_id=p["id"])["markdown"].startswith("# Passos")
    assert call(mcp, "excluir_processo", processo_id=p["id"])["ok"] is True
    assert call(mcp, "listar_processos")["processos"] == []


def test_html_flowchart_tool(flask_app):
    mcp = make_mcp(flask_app)
    html = "<style>.e{padding:8px}</style><div class='e'>Pedido</div>"
    p = call(mcp, "criar_processo", quadro_id=BOARD, nome="Visual", fluxograma_html=html)
    assert p["fluxogramaTipo"] == "html"
    up = call(mcp, "atualizar_processo", processo_id=p["id"], fluxograma_mermaid=FLOW)
    assert up["fluxogramaTipo"] == "mermaid"
    with pytest.raises(ToolError, match="não os dois"):
        call(mcp, "criar_processo", quadro_id=BOARD, nome="X", fluxograma_html=html, fluxograma_mermaid=FLOW)


def test_tool_errors_are_readable(flask_app):
    mcp = make_mcp(flask_app)
    with pytest.raises(ToolError, match="pelo menos um"):
        call(mcp, "criar_processo", quadro_id=BOARD, nome="X")
    with pytest.raises(ToolError, match="primeira linha"):
        call(mcp, "criar_processo", quadro_id=BOARD, nome="X", fluxograma_mermaid="A --> B")
    with pytest.raises(ToolError, match="não encontrado"):
        call(mcp, "obter_processo", processo_id="nada")
    with pytest.raises(ToolError, match="login"):
        call(make_mcp(flask_app, key="errada"), "listar_quadros")


def test_report_tools_are_compact(flask_app):
    mcp = make_mcp(flask_app)
    r = call(mcp, "resumo_do_dia", data="2026-11-11", quadro_ids=[BOARD])
    ana = next(p for p in r["pessoas"] if p["nome"] == "Ana Lima")
    assert ana["itensConcluidos"] == ["Cotar material (Orçamento)"]
    assert ana["itensAtrasados"][0].startswith("Fechar compra")
    d = call(mcp, "dashboard", dias=7)
    assert d["dias"] == 7 and d["quadros"][0]["nome"] == "Obras" and "serie" not in d


def test_tools_list_schema(flask_app):
    tools = {t.name: t for t in asyncio.run(make_mcp(flask_app).list_tools())}
    assert set(tools) == {"listar_quadros", "listar_processos", "obter_processo", "criar_processo",
                          "atualizar_processo", "excluir_processo", "resumo_do_dia", "dashboard"}
    schema = tools["criar_processo"].inputSchema
    assert schema["required"] == ["quadro_id", "nome"]
    assert "flowchart TD" in schema["properties"]["fluxograma_mermaid"]["description"]


def test_http_endpoint_requires_bearer(flask_app):
    env = {"PRODUZIA_API_URL": "http://produzia/api", "PRODUZIA_API_KEY": KEY, "MCP_TOKEN": TOKEN}
    asgi = server.create_app(env, transport=FlaskTransport(flask_app.test_client()))
    accept = {"Accept": "application/json, text/event-stream"}
    init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "teste", "version": "1"}}}
    with TestClient(asgi, base_url="https://produzia.olimpo-services.com.br") as tc:
        assert tc.get("/health").json() == {"status": "ok"}
        assert tc.post("/mcp", json=init, headers=accept).status_code == 401
        assert tc.post("/mcp", json=init, headers={**accept, "Authorization": "Bearer errado"}).status_code == 401

        auth = {**accept, "Authorization": f"Bearer {TOKEN}"}
        r = tc.post("/mcp", json=init, headers=auth)
        assert r.status_code == 200 and sse(r)["result"]["serverInfo"]["name"] == "produzia"
        r = tc.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, headers=auth)
        assert len(sse(r)["result"]["tools"]) == 8


def sse(response):
    data = [line[5:] for line in response.text.splitlines() if line.startswith("data:")]
    return json.loads(data[-1])


def test_empty_token_rejects_everything(flask_app):
    asgi = server.create_app({"MCP_TOKEN": "", "PRODUZIA_API_KEY": KEY})
    with TestClient(asgi) as tc:
        assert tc.post("/mcp", json={}, headers={"Authorization": "Bearer "}).status_code == 401
