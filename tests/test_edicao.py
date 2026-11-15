"""Edicao de cards e itens pelo Produzia: permissoes, validacoes e chamadas ao Trello/Power-Up."""
import pytest

from app import create_app
from app.trello import SourceError, write_error
from test_accounts import PersonTrello
from test_app import ANA, BETO, BOARD, CARD1, L_DONE, L_TODO, FakePowerUp, FakeTrello

ITEM = "e" * 32
CHECK = "d" * 32
LABEL = "f" * 24
OTHER_BOARD = "9" * 24
FOREIGN_CARD = "8" * 24


class WritableMixin:
    def setup_writes(self):
        self.calls = []
        self.fail = None
        self.card_data = {"id": CARD1, "name": "Orçamento", "desc": "", "idList": L_TODO, "idMembers": [ANA],
                          "idLabels": [], "start": "2026-11-02T12:00:00.000Z", "due": "2026-11-05T15:00:00.000Z",
                          "dueComplete": False, "shortUrl": "https://trello.com/c/1", "idBoard": BOARD}
        self.roles = {ANA: "normal", BETO: "observer"}

    def _maybe_fail(self):
        if self.fail:
            raise self.fail

    def card_board(self, card_id):
        if card_id == FOREIGN_CARD:
            return OTHER_BOARD
        if card_id != CARD1:
            raise SourceError("nao", 404)
        return BOARD

    def card(self, card_id):
        return dict(self.card_data)

    def labels(self, board_id):
        return [{"id": LABEL, "name": "Urgente", "color": "red"}]

    def memberships(self, board_id):
        return [{"idMember": m, "memberType": t} for m, t in self.roles.items()]

    def my_id(self):
        return ANA

    def comments(self, card_id):
        return [{"id": "c" * 24, "idMemberCreator": ANA, "date": "2026-11-11T10:00:00Z",
                 "data": {"text": "Olá"}, "memberCreator": {"id": ANA, "fullName": "Ana Lima"}}]

    def action(self, action_id):
        creator = ANA if action_id == "c" * 24 else BETO
        return {"id": action_id, "type": "commentCard", "idMemberCreator": creator,
                "data": {"card": {"id": CARD1}}}

    def update_card(self, card_id, fields):
        self._maybe_fail()
        self.calls.append(("update_card", card_id, fields))
        self.card_data.update(fields)
        return dict(self.card_data)

    def add_member(self, card_id, member_id):
        self.calls.append(("add_member", card_id, member_id))

    def remove_member(self, card_id, member_id):
        self.calls.append(("remove_member", card_id, member_id))

    def add_label(self, card_id, label_id):
        self.calls.append(("add_label", card_id, label_id))

    def remove_label(self, card_id, label_id):
        self.calls.append(("remove_label", card_id, label_id))

    def add_comment(self, card_id, text):
        self.calls.append(("add_comment", card_id, text))
        return {"id": "a" * 24, "date": "2026-11-11T10:00:00Z", "idMemberCreator": ANA,
                "data": {"text": text}, "memberCreator": {"id": ANA, "fullName": "Ana Lima"}}

    def edit_comment(self, action_id, text):
        self.calls.append(("edit_comment", action_id, text))

    def delete_comment(self, action_id):
        self.calls.append(("delete_comment", action_id))

    def forget_board(self, board_id):
        self.calls.append(("forget", board_id))


class WritableTrello(WritableMixin, FakeTrello):
    def __init__(self):
        super().__init__()
        self.setup_writes()


class WritablePowerUp(FakePowerUp):
    def __init__(self):
        super().__init__()
        self.calls = []
        self.item = {"id": ITEM, "texto": "Cotar", "dataInicio": None, "dataFim": "2026-11-09",
                     "responsavelId": ANA, "feito": False}

    def card_checklists(self, card_id):
        if card_id != CARD1:
            return []
        return [{"id": CHECK, "nome": "Etapas", "itens": [dict(self.item)]}]

    def update_item(self, item_id, fields):
        self.calls.append(("update_item", item_id, fields))
        self.item.update(fields)
        return dict(self.item)

    def delete_item(self, item_id):
        self.calls.append(("delete_item", item_id))

    def create_item(self, checklist_id, fields):
        self.calls.append(("create_item", checklist_id, fields))
        return {"id": "1" * 32, **fields, "feito": False}

    def create_checklist(self, card_id, board_id, nome):
        self.calls.append(("create_checklist", card_id, board_id, nome))
        return {"id": "2" * 32, "nome": nome, "itens": []}

    def forget_board(self, board_id):
        self.calls.append(("forget", board_id))


@pytest.fixture
def app(tmp_path):
    return create_app({
        "TESTING": True, "DATABASE_PATH": str(tmp_path / "t.sqlite3"), "APP_USER": "admin",
        "APP_PASSWORD": "senha", "SECRET_KEY": "x", "TRELLO": WritableTrello(), "POWERUP": WritablePowerUp(),
        "SESSION_COOKIE_SECURE": False,
    })


@pytest.fixture
def client(app):
    c = app.test_client()
    assert c.post("/api/login", json={"usuario": "admin", "senha": "senha"}).status_code == 200
    assert c.post("/api/boards", json={"ref": "https://trello.com/b/abc12345/obras"}).status_code == 201
    return c


def test_card_detail(client):
    data = client.get(f"/api/cards/{CARD1}").get_json()
    assert data["card"]["nome"] == "Orçamento" and data["card"]["prazo"] == "2026-11-05"
    assert data["card"]["inicio"] == "2026-11-02"
    assert [l["id"] for l in data["listas"]] == [L_TODO, L_DONE]
    assert [m["nome"] for m in data["membros"]] == ["Ana Lima", "Beto Reis"]
    assert data["etiquetas"][0]["nome"] == "Urgente"
    assert data["checklists"][0]["itens"][0]["id"] == ITEM
    assert data["comentarios"][0]["autor"]["nome"] == "Ana Lima" and data["euId"] == ANA


def test_requires_login_and_known_card(app, client):
    assert app.test_client().get(f"/api/cards/{CARD1}").status_code == 401
    assert client.get("/api/cards/naoexiste").status_code == 404
    assert client.get(f"/api/cards/{'7' * 24}").status_code == 404
    # Card de quadro nao cadastrado.
    assert client.patch(f"/api/cards/{FOREIGN_CARD}", json={"nome": "x"}).status_code == 404


def test_update_card_fields_and_dates(app, client):
    trello = app.config["TRELLO"]
    r = client.patch(f"/api/cards/{CARD1}", json={"nome": " Novo ", "prazo": "2026-11-20", "concluido": True})
    assert r.status_code == 200
    _, _, fields = trello.calls[0]
    assert fields["name"] == "Novo" and fields["dueComplete"] is True
    # Mantem a hora que o prazo ja tinha (12:00 em Sao Paulo = 15:00 UTC).
    assert fields["due"] == "2026-11-20T15:00:00Z"
    assert ("forget", BOARD) in trello.calls and ("forget", BOARD) in app.config["POWERUP"].calls
    assert r.get_json()["nome"] == "Novo"


def last_update(app):
    return [c for c in app.config["TRELLO"].calls if c[0] == "update_card"][-1][2]


def test_card_date_rules(app, client):
    assert client.patch(f"/api/cards/{CARD1}", json={"prazo": "2026-10-01"}).status_code == 400
    r = client.patch(f"/api/cards/{CARD1}", json={"prazo": "2026-10-01", "ajustarInicio": True})
    assert r.status_code == 200
    fields = last_update(app)
    assert fields["start"].startswith("2026-10-01") and fields["due"].startswith("2026-10-01")
    assert client.patch(f"/api/cards/{CARD1}", json={"prazo": "31/12"}).status_code == 400
    assert client.patch(f"/api/cards/{CARD1}", json={"prazo": None}).status_code == 200
    assert last_update(app)["due"] is None
    assert client.patch(f"/api/cards/{CARD1}", json={"listaId": "x"}).status_code == 400
    assert client.patch(f"/api/cards/{CARD1}", json={}).status_code == 400


def test_members_labels_and_comments(app, client):
    trello = app.config["TRELLO"]
    assert client.post(f"/api/cards/{CARD1}/membros", json={"id": BETO}).status_code == 200
    assert client.post(f"/api/cards/{CARD1}/membros", json={"id": "5" * 24}).status_code == 400
    assert client.delete(f"/api/cards/{CARD1}/membros/{ANA}").status_code == 200
    assert client.post(f"/api/cards/{CARD1}/etiquetas", json={"id": LABEL}).status_code == 200
    assert client.post(f"/api/cards/{CARD1}/etiquetas", json={"id": "4" * 24}).status_code == 400
    r = client.post(f"/api/cards/{CARD1}/comentarios", json={"texto": "Feito"})
    assert r.status_code == 201 and r.get_json()["texto"] == "Feito"
    assert client.patch(f"/api/cards/{CARD1}/comentarios/{'c' * 24}", json={"texto": "Editado"}).status_code == 200
    # Comentario de outra pessoa.
    assert client.delete(f"/api/cards/{CARD1}/comentarios/{'b' * 24}").status_code == 403
    assert client.delete(f"/api/cards/{CARD1}/comentarios/{'c' * 24}").status_code == 204
    kinds = [c[0] for c in trello.calls if c[0] != "forget"]
    assert kinds == ["add_member", "remove_member", "add_label", "add_comment", "edit_comment", "delete_comment"]


def test_items_go_to_powerup(app, client):
    powerup = app.config["POWERUP"]
    r = client.patch(f"/api/cards/{CARD1}/itens/{ITEM}", json={"feito": True})
    assert r.status_code == 200 and r.get_json()["feito"] is True
    assert client.patch(f"/api/cards/{CARD1}/itens/{ITEM}",
                        json={"texto": "Cotar aço", "dataFim": "2026-11-30", "responsavelId": BETO}).status_code == 200
    assert client.patch(f"/api/cards/{CARD1}/itens/{ITEM}", json={"responsavelId": "5" * 24}).status_code == 400
    assert client.patch(f"/api/cards/{CARD1}/itens/{'0' * 32}", json={"feito": True}).status_code == 404
    assert client.patch(f"/api/cards/{CARD1}/itens/{ITEM}", json={"feito": "sim"}).status_code == 400
    assert client.post(f"/api/cards/{CARD1}/checklists/{CHECK}/itens", json={"texto": "Novo"}).status_code == 201
    assert client.post(f"/api/cards/{CARD1}/checklists/{'3' * 32}/itens", json={"texto": "x"}).status_code == 404
    assert client.post(f"/api/cards/{CARD1}/checklists", json={"nome": "Fases"}).status_code == 201
    assert client.delete(f"/api/cards/{CARD1}/itens/{ITEM}").status_code == 204
    kinds = [c[0] for c in powerup.calls if c[0] != "forget"]
    assert kinds == ["update_item", "update_item", "create_item", "create_checklist", "delete_item"]


def test_trello_errors_are_clear(app, client):
    trello = app.config["TRELLO"]
    trello.fail = write_error(401, "unauthorized permission requested")
    r = client.patch(f"/api/cards/{CARD1}", json={"nome": "x"})
    assert r.status_code == 403 and "só de leitura" in r.get_json()["erro"]
    trello.fail = write_error(429, "")
    r = client.patch(f"/api/cards/{CARD1}", json={"nome": "x"})
    assert r.status_code == 429 and "limitou" in r.get_json()["erro"]
    assert write_error(401, "invalid token").status == 401
    assert write_error(403, "").status == 403


class WritablePerson(WritableMixin, PersonTrello):
    def __init__(self, member, boards):
        super().__init__(member, boards)
        self.setup_writes()


def test_observer_cannot_edit(tmp_path):
    clients = {"tok-ana": WritablePerson({"id": ANA, "fullName": "Ana Lima", "username": "ana"}, [BOARD]),
               "tok-beto": WritablePerson({"id": BETO, "fullName": "Beto Reis", "username": "beto"}, [BOARD])}
    app = create_app({
        "TESTING": True, "DATABASE_PATH": str(tmp_path / "t.sqlite3"), "APP_USER": "admin",
        "APP_PASSWORD": "senha", "SECRET_KEY": "segredo", "TRELLO": WritableTrello(), "POWERUP": WritablePowerUp(),
        "SESSION_COOKIE_SECURE": False, "TRELLO_FACTORY": lambda tok: clients[tok],
    })
    admin = app.test_client()
    admin.post("/api/login", json={"usuario": "admin", "senha": "senha"})
    admin.post("/api/boards", json={"ref": BOARD})
    ana, beto = app.test_client(), app.test_client()
    assert ana.post("/api/auth/trello", json={"token": "tok-ana"}).status_code == 200
    assert beto.post("/api/auth/trello", json={"token": "tok-beto"}).status_code == 200
    assert ana.patch(f"/api/cards/{CARD1}", json={"nome": "x"}).status_code == 200
    r = beto.patch(f"/api/cards/{CARD1}/itens/{ITEM}", json={"feito": True})
    assert r.status_code == 403 and "observador" in r.get_json()["erro"]
