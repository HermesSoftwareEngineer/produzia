from datetime import date
from zoneinfo import ZoneInfo

import pytest

from app import gantt
from test_app import ANA, BETO, BOARD, CARD1, CARD2, L_DONE, L_TODO, app, client  # noqa: F401

CARD3 = "695574f0" + "3" * 16
CARD4 = "695574f0" + "4" * 16


@pytest.fixture
def gclient(app, client, monkeypatch):  # noqa: F811
    monkeypatch.setattr(gantt, "today", lambda tz: date(2026, 11, 11))
    app.config["TRELLO"].extra_cards = [
        # Sem datas no card: o intervalo vem dos itens.
        {"id": CARD3, "name": "Projeto", "idList": L_TODO, "idMembers": [], "start": None, "due": None,
         "dueComplete": False, "shortUrl": "https://trello.com/c/3"},
        # So a entrega: vira um marco de um dia.
        {"id": CARD4, "name": "Vistoria", "idList": L_TODO, "idMembers": [BETO], "start": None,
         "due": "2026-12-01T15:00:00.000Z", "dueComplete": False, "shortUrl": "https://trello.com/c/4"},
    ]
    base = {"boardId": BOARD, "cardId": CARD3, "checklistNome": "Fases", "criadoEm": "2026-11-01T10:00:00+00:00",
            "concluidoEm": None, "concluidoPor": None, "feito": False}
    app.config["POWERUP"].extra_items = [
        {**base, "id": "i5", "texto": "Desenho", "responsavelId": BETO,
         "dataInicio": "2026-11-20", "dataFim": "2026-11-30"},
        {**base, "id": "i6", "texto": "Aprovação", "responsavelId": None,
         "dataInicio": "2026-11-15", "dataFim": None},
    ]
    return client


def test_gantt_requires_login_and_board(app, gclient):  # noqa: F811
    assert app.test_client().get(f"/api/gantt?quadro={BOARD}").status_code == 401
    assert gclient.get("/api/gantt").status_code == 404
    assert gclient.get(f"/api/gantt?quadro={'z' * 24}").status_code == 404


def test_gantt_shape(gclient):
    data = gclient.get(f"/api/gantt?quadro={BOARD}").get_json()
    assert data["quadro"]["id"] == BOARD and data["hoje"] == "2026-11-11"
    assert [(l["id"], l["concluida"]) for l in data["listas"]] == [(L_TODO, False), (L_DONE, True)]
    assert data["avisos"] == []
    # Ordem: lista, depois data de inicio (cards sem data no fim).
    assert [c["nome"] for c in data["cards"]] == ["Orçamento", "Projeto", "Vistoria", "Entrega"]
    assert [p["nome"] for p in data["pessoas"]] == ["Ana Lima", "Beto Reis"]
    assert data["intervalo"] == {"inicio": "2026-11-02", "fim": "2026-12-01"}


def test_gantt_card_ranges_and_status(gclient):
    cards = {c["id"]: c for c in gclient.get(f"/api/gantt?quadro={BOARD}").get_json()["cards"]}

    orc = cards[CARD1]
    assert (orc["inicio"], orc["fim"], orc["marco"], orc["derivado"]) == ("2026-11-02", "2026-11-05", False, False)
    assert orc["status"] == "atrasado" and orc["membros"] == [ANA]
    assert (orc["itensFeitos"], orc["itensTotal"]) == (2, 4)
    items = {i["id"]: i for i in orc["itens"]}
    assert items["i1"]["status"] == "concluido" and items["i1"]["checklist"] == "Etapas"
    assert items["i2"]["status"] == "atrasado" and items["i2"]["responsavel"] == ANA
    assert items["i3"]["inicio"] is None and items["i3"]["status"] == "semdata"
    assert (items["i4"]["inicio"], items["i4"]["fim"], items["i4"]["marco"]) == ("2026-11-20", "2026-11-20", True)

    proj = cards[CARD3]
    assert (proj["inicio"], proj["fim"], proj["derivado"]) == ("2026-11-15", "2026-11-30", True)
    assert proj["status"] == "futuro"
    i6 = next(i for i in proj["itens"] if i["id"] == "i6")
    assert (i6["inicio"], i6["fim"], i6["marco"]) == ("2026-11-15", "2026-11-15", True)

    vist = cards[CARD4]
    assert (vist["inicio"], vist["fim"], vist["marco"], vist["status"]) == ("2026-12-01", "2026-12-01", True, "futuro")

    ent = cards[CARD2]
    assert ent["emListaConcluida"] and ent["concluido"] and ent["status"] == "concluido"
    assert ent["inicio"] is None and ent["itens"] == []


def test_gantt_status_rules():
    tz = ZoneInfo("America/Sao_Paulo")
    board = {"id": BOARD, "nome": "Obras", "url": "u", "doneListIds": [L_DONE]}
    lists = [{"id": L_TODO, "name": "A fazer", "pos": 1}, {"id": L_DONE, "name": "Feito", "pos": 2},
             {"id": "9" * 24, "name": "Velha", "pos": 3, "closed": True}]
    cards = [
        {"id": "a", "name": "Hoje", "idList": L_TODO, "start": "2026-11-10T12:00:00.000Z",
         "due": "2026-11-12T12:00:00.000Z"},
        {"id": "b", "name": "Entregue", "idList": L_TODO, "due": "2026-11-01T12:00:00.000Z", "dueComplete": True},
        {"id": "c", "name": "Invertido", "idList": L_TODO, "start": "2026-11-20T12:00:00.000Z",
         "due": "2026-11-18T12:00:00.000Z"},
        # 01:00 UTC do dia 12 ainda e dia 11 em Sao Paulo.
        {"id": "d", "name": "Fuso", "idList": L_TODO, "due": "2026-11-12T01:00:00.000Z"},
    ]
    out = gantt.build(board, lists, [], cards, [], tz, date(2026, 11, 11))
    by_name = {c["nome"]: c for c in out["cards"]}
    assert {n: c["status"] for n, c in by_name.items()} == {
        "Hoje": "andamento", "Entregue": "concluido", "Invertido": "futuro", "Fuso": "andamento"}
    assert (by_name["Invertido"]["inicio"], by_name["Invertido"]["fim"]) == ("2026-11-18", "2026-11-20")
    assert by_name["Fuso"]["fim"] == "2026-11-11"
    # Lista arquivada sem cards fica de fora.
    assert [l["nome"] for l in out["listas"]] == ["A fazer", "Feito"]


def test_gantt_powerup_warning(app, gclient):  # noqa: F811
    app.config["POWERUP"].items = lambda board_id: ([], "Power-Up de checklists não configurado.")
    data = gclient.get(f"/api/gantt?quadro={BOARD}").get_json()
    assert data["avisos"] == ["Power-Up de checklists não configurado."]
    assert all(c["itens"] == [] for c in data["cards"])


def test_gantt_spa_route(gclient):
    assert gclient.get("/gantt").status_code in (200, 404)
