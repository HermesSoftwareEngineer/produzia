from datetime import date

import pytest

from app import gantt
from test_app import ANA, BETO, BOARD, CARD1, L_DONE, L_TODO, app, client  # noqa: F401

CARD3 = "695574f0" + "3" * 16
CARD4 = "695574f0" + "4" * 16
ARQUIVADO = "695574f0" + "9" * 16


@pytest.fixture
def cclient(app, client, monkeypatch):  # noqa: F811
    monkeypatch.setattr(gantt, "today", lambda tz: date(2026, 11, 11))
    app.config["TRELLO"].extra_cards = [
        # Na lista de concluido: concluido, mas sem data de conclusao conhecida.
        {"id": CARD3, "name": "Laudo", "idList": L_DONE, "idMembers": [ANA, BETO], "start": None,
         "due": "2026-11-12T15:00:00.000Z", "dueComplete": False, "shortUrl": "https://trello.com/c/3"},
        # So o inicio: o prazo cai no inicio. 02:00 UTC do dia 19 ainda e dia 18 em Sao Paulo.
        {"id": CARD4, "name": "Mobilização", "idList": L_TODO, "idMembers": [], "start": "2026-11-19T02:00:00.000Z",
         "due": None, "dueComplete": False, "shortUrl": "https://trello.com/c/4"},
    ]
    base = {"boardId": BOARD, "checklistNome": "Fases", "criadoEm": "2026-11-01T10:00:00+00:00",
            "concluidoEm": None, "concluidoPor": None, "feito": False, "dataFim": None}
    app.config["POWERUP"].extra_items = [
        {**base, "id": "i5", "cardId": CARD4, "texto": "Só início", "responsavelId": None, "dataInicio": "2026-11-16"},
        # Concluido as 01:30 UTC do dia 15 = dia 14 em Sao Paulo, sem datas planejadas.
        {**base, "id": "i6", "cardId": CARD4, "texto": "Tarde da noite", "responsavelId": BETO, "dataInicio": None,
         "feito": True, "concluidoEm": "2026-11-15T01:30:00+00:00", "concluidoPor": BETO},
        # Card arquivado/fechado: fica de fora.
        {**base, "id": "i7", "cardId": ARQUIVADO, "texto": "Fantasma", "responsavelId": ANA, "dataInicio": None,
         "dataFim": "2026-11-12"},
    ]
    return client


def get(c, query):
    resp = c.get(f"/api/calendario?{query}")
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()


def test_calendario_requires_login(app):  # noqa: F811
    assert app.test_client().get("/api/calendario?inicio=2026-11-01&fim=2026-11-30").status_code == 401


@pytest.mark.parametrize("query", [
    "", "inicio=2026-11-01", "inicio=ontem&fim=2026-11-30", "inicio=2026-11-30&fim=2026-11-01",
    "inicio=2026-11-01&fim=2027-01-02",  # 63 dias
])
def test_calendario_validates_range(cclient, query):
    resp = cclient.get(f"/api/calendario?{query}")
    assert resp.status_code == 400 and resp.get_json()["erro"]


def test_calendario_max_range_ok(cclient):
    assert cclient.get("/api/calendario?inicio=2026-11-01&fim=2027-01-01").status_code == 200


def test_calendario_month(cclient):
    data = get(cclient, "inicio=2026-11-01&fim=2026-11-30")
    assert (data["inicio"], data["fim"], data["hoje"]) == ("2026-11-01", "2026-11-30", "2026-11-11")
    by_id = {t["id"]: t for t in data["tarefas"]}
    assert set(by_id) == {"card:" + CARD1, "card:" + CARD3, "card:" + CARD4,
                          "item:i1", "item:i2", "item:i4", "item:i5", "item:i6"}
    # Ordenado por prazo (sem prazo no fim).
    prazos = [t["prazo"] or "9999" for t in data["tarefas"]]
    assert prazos == sorted(prazos)

    orc = by_id["card:" + CARD1]
    assert (orc["tipo"], orc["titulo"], orc["inicio"], orc["prazo"], orc["status"]) == (
        "card", "Orçamento", "2026-11-02", "2026-11-05", "atrasado")
    assert orc["card"] == {"id": CARD1, "nome": "Orçamento", "url": "https://trello.com/c/1", "lista": "A fazer",
                           "quadro": "Obras", "quadroId": BOARD, "arquivado": False}
    assert [p["nome"] for p in orc["responsaveis"]] == ["Ana Lima"]
    assert orc["responsaveis"][0]["iniciais"] == "AL"

    laudo = by_id["card:" + CARD3]
    assert laudo["concluido"] and laudo["status"] == "concluido" and laudo["concluidoEm"] is None
    assert [p["nome"] for p in laudo["responsaveis"]] == ["Ana Lima", "Beto Reis"]

    mob = by_id["card:" + CARD4]
    assert (mob["inicio"], mob["prazo"], mob["status"], mob["responsaveis"]) == ("2026-11-18", "2026-11-18", "pendente", [])

    i1 = by_id["item:i1"]
    assert (i1["tipo"], i1["titulo"], i1["checklist"], i1["prazo"]) == ("item", "Cotar material", "Etapas", "2026-11-11")
    assert (i1["concluido"], i1["concluidoEm"], i1["status"]) == (True, "2026-11-11", "concluido")
    assert i1["card"]["nome"] == "Orçamento" and i1["responsaveis"][0]["id"] == ANA

    assert by_id["item:i2"]["status"] == "atrasado"
    assert (by_id["item:i4"]["prazo"], by_id["item:i4"]["concluidoEm"]) == ("2026-11-20", "2026-11-13")
    assert (by_id["item:i5"]["prazo"], by_id["item:i5"]["status"]) == ("2026-11-16", "pendente")
    i6 = by_id["item:i6"]
    assert (i6["prazo"], i6["concluidoEm"]) == (None, "2026-11-14")

    assert [t["id"] for t in data["atrasadas"]] == ["card:" + CARD1, "item:i2"]
    assert [p["nome"] for p in data["pessoas"]] == ["Ana Lima", "Beto Reis", "Sem responsável"]
    assert data["totais"] == {"tarefas": 8, "concluidas": 4, "atrasadas": 2}


def test_calendario_status_hoje_and_completion_range(cclient):
    data = get(cclient, "inicio=2026-11-12&fim=2026-11-15")
    ids = [t["id"] for t in data["tarefas"]]
    # i4 entra pela conclusao (dia 13) mesmo com prazo no dia 20; i6 pela conclusao no dia 14.
    assert ids == ["card:" + CARD3, "item:i4", "item:i6"]
    # As atrasadas vem sempre, independente do intervalo.
    assert [t["id"] for t in data["atrasadas"]] == ["card:" + CARD1, "item:i2"]

    today = get(cclient, "inicio=2026-11-11&fim=2026-11-11")
    assert [t["id"] for t in today["tarefas"]] == ["item:i1"]


def test_calendario_hoje_status(app, cclient):  # noqa: F811
    app.config["POWERUP"].extra_items.append(
        {"id": "i8", "cardId": CARD1, "texto": "Para hoje", "checklistNome": "Etapas", "responsavelId": ANA,
         "dataInicio": None, "dataFim": "2026-11-11", "feito": False, "concluidoEm": None})
    data = get(cclient, "inicio=2026-11-11&fim=2026-11-11")
    assert [(t["id"], t["status"]) for t in data["tarefas"]] == [("item:i8", "hoje"), ("item:i1", "concluido")]


def test_calendario_board_filter_and_warning(app, cclient):  # noqa: F811
    data = get(cclient, f"quadros={'z' * 24}&inicio=2026-11-01&fim=2026-11-30")
    assert data["tarefas"] == [] and data["atrasadas"] == [] and data["pessoas"] == []
    assert get(cclient, f"quadros={BOARD}&inicio=2026-11-01&fim=2026-11-30")["totais"]["tarefas"] == 8

    app.config["POWERUP"].items = lambda board_id: ([], "Power-Up de checklists não configurado.")
    data = get(cclient, "inicio=2026-11-01&fim=2026-11-30")
    assert data["avisos"] == ["Obras: Power-Up de checklists não configurado."]
    assert {t["tipo"] for t in data["tarefas"]} == {"card"}


def test_calendario_spa_route(cclient):
    assert cclient.get("/calendario").status_code in (200, 404)
