"""Contas pelo Trello: cada pessoa ve so os quadros de que participa."""
import pytest

from app import create_app

from test_app import ANA, BETO, BOARD, FakePowerUp, FakeTrello

OUTRO_QUADRO = "f" * 24
KEY = "chave-servico"


class PersonTrello(FakeTrello):
    """Trello visto por uma pessoa: os mesmos dados, mas so os quadros dela."""

    def __init__(self, member, boards):
        super().__init__()
        self.member = member
        self.boards = boards

    def me(self):
        return self.member

    def my_boards(self):
        return [{"id": b, "name": f"Quadro {b[:4]}", "url": f"https://trello.com/b/{b[:8]}"} for b in self.boards]

    def board(self, ref):
        if ref == OUTRO_QUADRO:
            return {"id": OUTRO_QUADRO, "name": "Outro", "url": "https://trello.com/b/outro"}
        return super().board(ref)


PEOPLE = {
    "tok-ana": ({"id": ANA, "fullName": "Ana Lima", "username": "ana", "initials": "AL", "avatarUrl": None}, [BOARD]),
    "tok-beto": ({"id": BETO, "fullName": "Beto Reis", "username": "beto", "initials": "BR", "avatarUrl": None},
                 [OUTRO_QUADRO]),
}


def factory(token):
    if token not in PEOPLE:
        from app.trello import SourceError
        raise SourceError("Trello respondeu 401", 401)
    member, boards = PEOPLE[token]
    return PersonTrello(member, boards)


class FactoryWithError:
    def __call__(self, token):
        return factory(token)


@pytest.fixture
def app(tmp_path):
    return create_app({
        "TESTING": True, "DATABASE_PATH": str(tmp_path / "a.sqlite3"), "APP_USER": "admin",
        "APP_PASSWORD": "senha", "SECRET_KEY": "segredo", "TRELLO": FakeTrello(), "POWERUP": FakePowerUp(),
        "SESSION_COOKIE_SECURE": False, "PRODUZIA_API_KEY": KEY, "TRELLO_KEY": "chave-publica",
        "TRELLO_FACTORY": FactoryWithError(),
    })


@pytest.fixture
def admin(app):
    c = app.test_client()
    assert c.post("/api/login", json={"usuario": "admin", "senha": "senha"}).status_code == 200
    assert c.post("/api/boards", json={"ref": BOARD}).status_code == 201
    return c


def trello_login(app, token):
    c = app.test_client()
    r = c.post("/api/auth/trello", json={"token": token})
    return c, r


def test_auth_config_is_public(app):
    assert app.test_client().get("/api/auth/config").get_json() == {"trelloKey": "chave-publica", "loginAdmin": True}


def test_login_with_trello_creates_account(app, admin):
    c, r = trello_login(app, "tok-ana")
    assert r.status_code == 200
    me = c.get("/api/me").get_json()
    assert (me["id"], me["nome"], me["admin"]) == (ANA, "Ana Lima", False)
    # O token fica cifrado no banco
    with app.app_context():
        from app import db
        row = db.get_db().execute("SELECT token_cifrado FROM usuarios WHERE id = ?", (ANA,)).fetchone()
        assert row and "tok-ana" not in row["token_cifrado"]


def test_invalid_trello_token_is_rejected(app):
    _, r = trello_login(app, "tok-invalido")
    assert r.status_code == 401
    _, r = trello_login(app, "")
    assert r.status_code == 400


def test_each_person_sees_only_their_boards(app, admin):
    ana, _ = trello_login(app, "tok-ana")
    beto, _ = trello_login(app, "tok-beto")
    assert [b["id"] for b in ana.get("/api/boards").get_json()["quadros"]] == [BOARD]
    assert beto.get("/api/boards").get_json()["quadros"] == []
    # Relatorios so com os quadros visiveis
    assert ana.get("/api/resumo?data=2026-11-11").get_json()["totais"]["comentarios"] == 1
    assert beto.get("/api/resumo?data=2026-11-11").get_json()["totais"]["comentarios"] == 0
    assert beto.get(f"/api/gantt?quadro={BOARD}").status_code == 404
    assert beto.get(f"/api/boards/{BOARD}/lists").status_code == 404
    assert beto.put(f"/api/boards/{BOARD}", json={"doneListIds": []}).status_code == 404
    assert beto.delete(f"/api/boards/{BOARD}").status_code == 404
    # Cadastrar: so quadros de que participa
    assert ana.post("/api/boards", json={"ref": OUTRO_QUADRO}).status_code == 403
    assert beto.post("/api/boards", json={"ref": OUTRO_QUADRO}).status_code == 201
    assert [b["id"] for b in beto.get("/api/boards").get_json()["quadros"]] == [OUTRO_QUADRO]
    # O administrador ve todos
    assert {b["id"] for b in admin.get("/api/boards").get_json()["quadros"]} == {BOARD, OUTRO_QUADRO}


def test_trello_boards_list_uses_persons_token(app, admin):
    beto, _ = trello_login(app, "tok-beto")
    assert [b["id"] for b in beto.get("/api/trello/boards").get_json()["quadros"]] == [OUTRO_QUADRO]


def test_processes_follow_board_access(app, admin):
    ana, _ = trello_login(app, "tok-ana")
    beto, _ = trello_login(app, "tok-beto")
    p = ana.post("/api/processos", json={"quadroId": BOARD, "nome": "Compras", "markdown": "# Passos"})
    assert p.status_code == 201
    pid = p.get_json()["id"]
    assert [x["id"] for x in ana.get("/api/processos").get_json()["processos"]] == [pid]
    assert beto.get("/api/processos").get_json()["processos"] == []
    assert beto.get(f"/api/processos/{pid}").status_code == 404
    assert beto.patch(f"/api/processos/{pid}", json={"nome": "X"}).status_code == 404
    assert beto.post("/api/processos", json={"quadroId": BOARD, "nome": "X", "markdown": "a"}).status_code == 400
    assert admin.get(f"/api/processos/{pid}").status_code == 200


def test_service_key_can_act_as_a_person(app, admin):
    trello_login(app, "tok-beto")
    svc = app.test_client()
    as_beto = {"X-API-Key": KEY, "X-Produzia-Usuario": BETO}
    assert svc.get("/api/boards", headers=as_beto).get_json()["quadros"] == []
    assert svc.get("/api/boards", headers={"X-API-Key": KEY}).get_json()["quadros"][0]["id"] == BOARD
    assert svc.get("/api/boards", headers={"X-API-Key": KEY, "X-Produzia-Usuario": "nao-existe"}).status_code == 401
    # Rota de servico que cria a conta a partir de um token (usada pelo login OAuth do MCP)
    r = svc.post("/api/servico/usuarios", json={"token": "tok-ana"}, headers={"X-API-Key": KEY})
    assert r.status_code == 200 and r.get_json()["id"] == ANA
    assert svc.post("/api/servico/usuarios", json={"token": "tok-ana"}).status_code == 401


def test_changed_secret_forces_new_login(tmp_path, app, admin):
    ana, _ = trello_login(app, "tok-ana")
    other = create_app({**app.config, "SECRET_KEY": "outro"})
    with other.test_client() as c:
        with c.session_transaction() as sess:
            sess["uid"] = ANA
        assert c.get("/api/me").status_code == 401
