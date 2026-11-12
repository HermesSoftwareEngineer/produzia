from datetime import date
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.cache import TTLCache
from app.trello import SourceError

TZ = ZoneInfo("America/Sao_Paulo")
BOARD = "b" * 24
ANA = "a" * 24
BETO = "c" * 24
L_TODO, L_DONE = "1" * 24, "2" * 24
# Card criado em 2026-01-01 (timestamp no prefixo do id).
CARD1 = "695574f0" + "0" * 16
CARD2 = "695574f0" + "1" * 16


class FakeTrello:
    def __init__(self):
        self.cache = TTLCache()
        self.extra_cards = []  # cards a mais para testes especificos (ex.: cronograma)
        self.actions_data = [
            {"id": "x1", "type": "commentCard", "date": "2026-11-11T13:00:00.000Z", "idMemberCreator": ANA,
             "memberCreator": {"id": ANA, "fullName": "Ana Lima", "username": "ana"},
             "data": {"text": "Feito o orçamento", "card": {"id": CARD1, "name": "Orçamento"}}},
            {"id": "x2", "type": "updateCard", "date": "2026-11-11T15:00:00.000Z", "idMemberCreator": BETO,
             "data": {"card": {"id": CARD2, "name": "Entrega"}, "listBefore": {"id": L_TODO, "name": "A fazer"},
                      "listAfter": {"id": L_DONE, "name": "Concluído"}}},
            # 01:00 UTC do dia 12 ainda e dia 11 em Sao Paulo.
            {"id": "x3", "type": "createCard", "date": "2026-11-12T01:00:00.000Z", "idMemberCreator": BETO,
             "data": {"card": {"id": CARD1, "name": "Orçamento"}, "list": {"name": "A fazer"}}},
            {"id": "x4", "type": "commentCard", "date": "2026-11-10T13:00:00.000Z", "idMemberCreator": ANA,
             "data": {"text": "Ontem", "card": {"id": CARD1, "name": "Orçamento"}}},
        ]

    def configured(self):
        return True

    def my_boards(self):
        return [{"id": BOARD, "name": "Obras", "url": "https://trello.com/b/abc12345/obras"}]

    def board(self, ref):
        if ref not in (BOARD, "abc12345"):
            raise SourceError("Quadro não encontrado no Trello (ou sem acesso).", 404)
        return {"id": BOARD, "name": "Obras", "url": "https://trello.com/b/abc12345/obras"}

    def lists(self, board_id):
        return [{"id": L_TODO, "name": "A fazer", "pos": 1}, {"id": L_DONE, "name": "Concluído", "pos": 2}]

    def members(self, board_id):
        return [{"id": ANA, "fullName": "Ana Lima", "username": "ana", "initials": "AL"},
                {"id": BETO, "fullName": "Beto Reis", "username": "beto", "initials": "BR"}]

    def open_cards(self, board_id):
        return [
            {"id": CARD1, "name": "Orçamento", "idList": L_TODO, "idMembers": [ANA],
             "start": "2026-11-02T03:00:00.000Z", "due": "2026-11-05T15:00:00.000Z", "dueComplete": False, "shortUrl": "https://trello.com/c/1"},
            {"id": CARD2, "name": "Entrega", "idList": L_DONE, "idMembers": [BETO],
             "start": None, "due": None, "dueComplete": False, "shortUrl": "https://trello.com/c/2"},
            *self.extra_cards,
        ]

    def actions(self, board_id, since, before, ttl=60):
        return [a for a in self.actions_data if since <= a["date"] < before]


class FakePowerUp:
    def __init__(self):
        self.cache = TTLCache()
        self.extra_items = []

    def items(self, board_id):
        base = {"boardId": board_id, "cardId": CARD1, "checklistNome": "Etapas", "dataInicio": None,
                "criadoEm": "2026-11-01T10:00:00+00:00"}
        return [
            {**base, "id": "i1", "texto": "Cotar material", "responsavelId": ANA, "feito": True,
             "concluidoEm": "2026-11-11T14:00:00+00:00", "concluidoPor": ANA, "dataFim": "2026-11-11"},
            {**base, "id": "i2", "texto": "Fechar compra", "responsavelId": ANA, "feito": False,
             "concluidoEm": None, "concluidoPor": None, "dataFim": "2026-11-09"},
            {**base, "id": "i3", "texto": "Sem dono", "responsavelId": None, "feito": False,
             "concluidoEm": None, "concluidoPor": None, "dataFim": None},
            # Concluido depois do dia 11: no resumo do dia 11 ainda aparece como pendente.
            {**base, "id": "i4", "texto": "Medir obra", "responsavelId": BETO, "feito": True,
             "concluidoEm": "2026-11-13T12:00:00+00:00", "concluidoPor": BETO, "dataFim": "2026-11-20"},
            *self.extra_items,
        ], None


@pytest.fixture
def app(tmp_path):
    return create_app({
        "TESTING": True, "DATABASE_PATH": str(tmp_path / "t.sqlite3"), "APP_USER": "admin",
        "APP_PASSWORD": "senha", "SECRET_KEY": "x", "TRELLO": FakeTrello(), "POWERUP": FakePowerUp(),
        "SESSION_COOKIE_SECURE": False,
    })


@pytest.fixture
def client(app):
    c = app.test_client()
    assert c.post("/api/login", json={"usuario": "admin", "senha": "senha"}).status_code == 200
    assert c.post("/api/boards", json={"ref": "https://trello.com/b/abc12345/obras"}).status_code == 201
    return c


def test_requires_login(app):
    c = app.test_client()
    assert c.get("/api/boards").status_code == 401
    assert c.post("/api/login", json={"usuario": "admin", "senha": "errada"}).status_code == 401


def test_login_rate_limited(app):
    c = app.test_client()
    for _ in range(8):
        c.post("/api/login", json={"usuario": "admin", "senha": "x"})
    assert c.post("/api/login", json={"usuario": "admin", "senha": "senha"}).status_code == 429


def test_board_registration_detects_done_lists(client):
    (board,) = client.get("/api/boards").get_json()["quadros"]
    assert board["doneListIds"] == [L_DONE]
    assert client.post("/api/boards", json={"ref": BOARD}).status_code == 409
    assert client.post("/api/boards", json={"ref": "lixo !!"}).status_code == 400
    assert client.put(f"/api/boards/{BOARD}", json={"doneListIds": [L_TODO, "z" * 24]}).get_json()["doneListIds"] == [L_TODO]


def test_day_summary_per_person(client):
    data = client.get("/api/resumo?data=2026-11-11").get_json()
    people = {p["pessoa"]["id"]: p for p in data["pessoas"]}
    ana, beto = people[ANA], people[BETO]

    assert [i["texto"] for i in ana["itensConcluidos"]] == ["Cotar material"]
    assert ana["itensConcluidos"][0]["hora"] == ""  # conta pelo prazo, sem horario
    assert [c["texto"] for c in ana["comentarios"]] == ["Feito o orçamento"]
    assert [(i["texto"], i["status"]) for i in ana["itensPendentes"]] == [("Fechar compra", "atrasado")]
    assert [(c["card"]["nome"], c["status"]) for c in ana["cardsPendentes"]] == [("Orçamento", "atrasado")]

    assert [c["card"]["nome"] for c in beto["cardsConcluidos"]] == ["Entrega"]
    assert beto["totais"]["cardsCriados"] == 1
    # "Medir obra" esta feito com prazo no dia 20: nao e pendente do dia 11.
    assert beto["itensPendentes"] == []

    # Item em aberto sem prazo nao entra no resumo de nenhum dia.
    assert "_sem" not in people or people["_sem"]["totais"]["itensPendentes"] == 0
    assert data["totais"]["comentarios"] == 1 and data["totais"]["cardsConcluidos"] == 1


def test_item_counts_on_its_deadline(client):
    """Concluido conta no dia do prazo, nao no dia em que foi marcado."""
    def itens(day, pid, key):
        data = client.get(f"/api/resumo?data={day}").get_json()
        row = next((p for p in data["pessoas"] if p["pessoa"]["id"] == pid), None)
        return [i["texto"] for i in row[key]] if row else []

    # Marcado no dia 13, prazo no dia 20
    assert itens("2026-11-13", BETO, "itensConcluidos") == []
    assert itens("2026-11-20", BETO, "itensConcluidos") == ["Medir obra"]
    # Em aberto com prazo no dia 9: pendente do dia 9 ("hoje") e atrasado depois
    data = client.get("/api/resumo?data=2026-11-09").get_json()
    ana = next(p for p in data["pessoas"] if p["pessoa"]["id"] == ANA)
    assert [(i["texto"], i["status"]) for i in ana["itensPendentes"]] == [("Fechar compra", "hoje")]
    assert itens("2026-11-08", ANA, "itensPendentes") == []


def test_day_summary_other_day(client):
    data = client.get("/api/resumo?data=2026-11-10").get_json()
    ana = next(p for p in data["pessoas"] if p["pessoa"]["id"] == ANA)
    assert [c["texto"] for c in ana["comentarios"]] == ["Ontem"]
    assert ana["itensConcluidos"] == []
    assert client.get("/api/resumo?data=ontem").status_code == 400


def test_dashboard_metrics(app, client):
    from app import metrics

    trello, powerup = app.config["TRELLO"], app.config["POWERUP"]
    boards = [{"id": BOARD, "nome": "Obras", "url": "u", "doneListIds": [L_DONE]}]
    start, _ = metrics.day_bounds(date(2026, 11, 1), TZ)
    _, end = metrics.day_bounds(date(2026, 11, 14), TZ)
    data = metrics.collect(boards, trello, powerup, start, end)
    out = metrics.dashboard(data, date(2026, 11, 14), 7, TZ)
    k = out["kpis"]
    # Itens pelo prazo: "Cotar material" (11/11) entra; "Medir obra" (prazo 20/11) fica fora.
    assert k["cardsConcluidos"] == 1 and k["itensConcluidos"] == 1 and k["comentarios"] == 2
    assert k["cardsAbertos"] == 1 and k["cardsAtrasados"] == 1
    assert k["itensTotal"] == 4 and k["itensFeitos"] == 2 and k["taxaChecklist"] == 50
    assert len(out["serie"]) == 7
    assert next(r for r in out["ranking"] if r["pessoa"]["id"] == ANA)["itensConcluidos"] == 1
    (board,) = out["quadros"]
    assert [l["cards"] for l in board["listas"]] == [1, 1]

    assert client.get("/api/dashboard?dias=7").status_code == 200


def test_spa_routes_served(client, tmp_path):
    for path in ("/", "/resumo", "/quadros", "/login"):
        assert client.get(path).status_code in (200, 404)  # 404 quando o front nao foi buildado
    assert client.get("/health").get_json() == {"status": "ok"}
