import pytest

from app import create_app
from app.processos import mermaid_error

from test_app import BOARD, FakePowerUp, FakeTrello

KEY = "chave-de-servico"
FLOW = "flowchart TD\n  A[Pedido] --> B{Aprovado?}\n  B -->|sim| C[Faturar]\n"


@pytest.fixture
def app(tmp_path):
    return create_app({
        "TESTING": True, "DATABASE_PATH": str(tmp_path / "p.sqlite3"), "APP_USER": "admin",
        "APP_PASSWORD": "senha", "SECRET_KEY": "x", "TRELLO": FakeTrello(), "POWERUP": FakePowerUp(),
        "SESSION_COOKIE_SECURE": False, "PRODUZIA_API_KEY": KEY,
    })


@pytest.fixture
def client(app):
    c = app.test_client()
    assert c.post("/api/login", json={"usuario": "admin", "senha": "senha"}).status_code == 200
    assert c.post("/api/boards", json={"ref": BOARD}).status_code == 201
    return c


@pytest.fixture
def service(app, client):  # client garante o quadro cadastrado
    c = app.test_client()
    c.environ_base["HTTP_X_API_KEY"] = KEY
    return c


def novo(**extra):
    return {"quadroId": BOARD, "nome": "Faturamento", "descricao": "Do pedido à nota",
            "categoria": "Financeiro", "markdown": "# Passos\n\n- [x] Conferir\n- [ ] Emitir", **extra}


def test_requires_auth(app):
    c = app.test_client()
    assert c.get("/api/processos").status_code == 401
    assert c.get("/api/processos", headers={"X-API-Key": "errada"}).status_code == 401
    assert c.post("/api/processos", json=novo()).status_code == 401


def test_empty_key_never_matches(tmp_path):
    app = create_app({"TESTING": True, "DATABASE_PATH": str(tmp_path / "e.sqlite3"),
                      "TRELLO": FakeTrello(), "POWERUP": FakePowerUp(), "PRODUZIA_API_KEY": ""})
    c = app.test_client()
    assert c.get("/api/processos", headers={"X-API-Key": ""}).status_code == 401
    assert c.get("/api/boards", headers={"X-API-Key": ""}).status_code == 401


def test_crud_with_session(client):
    r = client.post("/api/processos", json=novo())
    assert r.status_code == 201
    p = r.get_json()
    assert p["quadroNome"] == "Obras" and p["atualizadoPor"] == "web"
    assert p["temDocumento"] and not p["temFluxograma"] and p["fluxograma"] is None

    (item,) = client.get(f"/api/processos?quadro={BOARD}").get_json()["processos"]
    assert item["id"] == p["id"] and "markdown" not in item
    assert client.get("/api/processos?quadro=outro").get_json()["processos"] == []

    r = client.patch(f"/api/processos/{p['id']}", json={"fluxograma": FLOW, "categoria": ""})
    assert r.status_code == 200
    up = r.get_json()
    assert up["temFluxograma"] and up["categoria"] is None and up["markdown"] == novo()["markdown"]

    assert client.delete(f"/api/processos/{p['id']}").status_code == 204
    assert client.get(f"/api/processos/{p['id']}").status_code == 404
    assert client.delete(f"/api/processos/{p['id']}").status_code == 404


def test_service_key_marks_mcp(service, client):
    r = service.post("/api/processos", json=novo(markdown=None, fluxograma=FLOW))
    assert r.status_code == 201
    pid = r.get_json()["id"]
    assert r.get_json()["atualizadoPor"] == "mcp"
    assert service.get(f"/api/processos/{pid}").get_json()["fluxograma"] == FLOW
    assert client.put(f"/api/processos/{pid}", json={"nome": "Faturar"}).get_json()["atualizadoPor"] == "web"


def test_service_key_reads_reports(service):
    assert service.get("/api/boards").get_json()["quadros"][0]["id"] == BOARD
    assert service.get("/api/resumo?data=2026-11-11").status_code == 200
    assert service.get("/api/dashboard?dias=7").status_code == 200
    # A chave nao libera rotas de escrita dos quadros.
    assert service.post("/api/boards", json={"ref": BOARD}).status_code == 401
    assert service.post("/api/cache/clear").status_code == 401


def test_validation(client):
    def err(body, pid=None):
        r = client.patch(f"/api/processos/{pid}", json=body) if pid else client.post("/api/processos", json=body)
        assert r.status_code == 400, r.get_json()
        return r.get_json()["erro"]

    assert "Pelo menos um" in err(novo(markdown="  "))
    assert "Quadro" in err(novo(quadroId="naoexiste"))
    assert "nome" in err(novo(nome="  "))
    assert "120" in err(novo(nome="x" * 121))
    assert "texto" in err(novo(markdown=123))
    assert "KB" in err(novo(markdown="a" * (200 * 1024 + 1)))
    assert "KB" in err(novo(fluxograma="flowchart TD\n" + "a" * 50 * 1024))
    assert "primeira linha" in err(novo(fluxograma="A --> B"))
    assert client.post("/api/processos", data="x", content_type="text/plain").status_code == 400

    pid = client.post("/api/processos", json=novo()).get_json()["id"]
    assert "Pelo menos um" in err({"markdown": None}, pid)
    assert "Nada" in err({"outro": 1}, pid)
    assert "Quadro" in err({"quadroId": "zz"}, pid)


def test_mermaid_light_check():
    assert mermaid_error("graph LR\nA-->B") is None
    assert mermaid_error("%% comentario\nsequenceDiagram\nA->>B: oi") is None
    assert mermaid_error("---\ntitle: Vendas\n---\nflowchart TD\nA-->B") is None
    assert mermaid_error("stateDiagram-v2\n[*] --> A") is None
    assert mermaid_error("---\ntitle: x\nflowchart TD") is not None
    assert mermaid_error("olá mundo") is not None
    assert mermaid_error("%% so comentario") == "Fluxograma vazio."


def test_spa_route(client):
    assert client.get("/processos").status_code in (200, 404)


HTML = "<style>.etapa{padding:8px}</style><div class='etapa'>Pedido</div>"


def test_html_flowchart(client):
    p = client.post("/api/processos", json=novo(markdown=None, fluxograma=HTML, fluxogramaTipo="html")).get_json()
    assert p["fluxogramaTipo"] == "html" and p["fluxograma"].startswith("<style>")
    # HTML enviado sem o tipo tambem e reconhecido
    auto = client.post("/api/processos", json=novo(fluxograma=HTML)).get_json()
    assert auto["fluxogramaTipo"] == "html"
    # Mermaid continua sendo o padrao e validado
    m = client.post("/api/processos", json=novo(fluxograma=FLOW)).get_json()
    assert m["fluxogramaTipo"] == "mermaid"
    assert client.post("/api/processos", json=novo(fluxograma="isso nao e mermaid")).status_code == 400
    # Trocar de HTML para Mermaid exige um fluxograma Mermaid valido
    assert client.patch(f"/api/processos/{p['id']}", json={"fluxogramaTipo": "mermaid"}).status_code == 400
    ok = client.patch(f"/api/processos/{p['id']}", json={"fluxogramaTipo": "mermaid", "fluxograma": FLOW})
    assert ok.get_json()["fluxogramaTipo"] == "mermaid"
    assert client.post("/api/processos", json=novo(fluxogramaTipo="svg")).status_code == 400
    grande = "<div>" + "x" * (310 * 1024) + "</div>"
    assert client.post("/api/processos", json=novo(fluxograma=grande, fluxogramaTipo="html")).status_code == 400


def test_existing_database_gets_flowchart_type(tmp_path):
    import sqlite3
    path = tmp_path / "old.sqlite3"
    conn = sqlite3.connect(path)
    conn.executescript(
        "CREATE TABLE processos (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, nome TEXT NOT NULL,"
        " descricao TEXT, categoria TEXT, markdown TEXT, fluxograma TEXT, criado_em TEXT NOT NULL,"
        " atualizado_em TEXT NOT NULL, atualizado_por TEXT NOT NULL);"
        "INSERT INTO processos VALUES ('p1', 'b', 'Antigo', '', NULL, NULL, 'flowchart TD', 't', 't', 'web');"
    )
    conn.commit()
    conn.close()
    create_app({"TESTING": True, "DATABASE_PATH": str(path), "TRELLO": FakeTrello(), "POWERUP": FakePowerUp()})
    row = sqlite3.connect(path).execute("SELECT fluxograma_tipo FROM processos").fetchone()
    assert row == ("mermaid",)
