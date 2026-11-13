"""Contas do Produzia ligadas ao Trello.

Cada pessoa entra com a propria conta do Trello: o token dela fica no banco
(criptografado) e todas as leituras do Trello passam a ser feitas com ele. Assim
cada um so ve os quadros de que participa e os cards a que tem acesso.

O login de administrador (APP_USER/APP_PASSWORD) continua existindo e usa o token
do servidor (TRELLO_TOKEN), vendo todos os quadros cadastrados. A chave de servico
(X-API-Key, usada pelo servidor MCP) age como administrador, ou como a pessoa
informada no header X-Produzia-Usuario.
"""
import base64
import hashlib
import threading
from datetime import datetime, timezone

from cryptography.fernet import Fernet, InvalidToken
from flask import current_app, g, request, session

from . import db
from .trello import TrelloClient

USER_HEADER = "X-Produzia-Usuario"

SCHEMA = """
CREATE TABLE IF NOT EXISTS usuarios (
    id             TEXT PRIMARY KEY,      -- id do membro no Trello
    username       TEXT,
    nome           TEXT NOT NULL,
    iniciais       TEXT,
    avatar         TEXT,
    token_cifrado  TEXT NOT NULL,
    criado_em      TEXT NOT NULL,
    ultimo_acesso  TEXT NOT NULL
);
"""


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _fernet():
    digest = hashlib.sha256(("produzia-trello:" + current_app.config["SECRET_KEY"]).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def init_schema(conn):
    conn.executescript(SCHEMA)


# --- Usuarios ----------------------------------------------------------------


def serialize_user(row):
    return {"id": row["id"], "username": row["username"], "nome": row["nome"],
            "iniciais": row["iniciais"], "avatar": row["avatar"]}


def get_user(user_id):
    return db.get_db().execute("SELECT * FROM usuarios WHERE id = ?", (user_id or "",)).fetchone()


def list_users():
    rows = db.get_db().execute("SELECT * FROM usuarios ORDER BY nome COLLATE NOCASE").fetchall()
    return [serialize_user(r) for r in rows]


def save_user(member, token):
    """Cria ou atualiza a conta a partir do /members/me do Trello."""
    avatar = member.get("avatarUrl")
    now = _now()
    db.get_db().execute(
        "INSERT INTO usuarios (id, username, nome, iniciais, avatar, token_cifrado, criado_em, ultimo_acesso)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT(id) DO UPDATE SET username = excluded.username, nome = excluded.nome,"
        " iniciais = excluded.iniciais, avatar = excluded.avatar, token_cifrado = excluded.token_cifrado,"
        " ultimo_acesso = excluded.ultimo_acesso",
        (member["id"], member.get("username"), member.get("fullName") or member.get("username") or "Membro",
         member.get("initials"), f"{avatar}/50.png" if avatar else None,
         _fernet().encrypt(token.encode()).decode(), now, now),
    )
    forget_client(member["id"])
    return get_user(member["id"])


def touch(user_id):
    db.get_db().execute("UPDATE usuarios SET ultimo_acesso = ? WHERE id = ?", (_now(), user_id))


# --- Clientes do Trello por pessoa ------------------------------------------

_clients_lock = threading.Lock()


def _clients():
    """Clientes por pessoa, guardados no proprio app (um cache por instancia)."""
    return current_app.extensions.setdefault("produzia_trello_clients", {})


def forget_client(user_id):
    with _clients_lock:
        _clients().pop(user_id, None)


def client_for(row):
    """Cliente do Trello com o token da pessoa (um por pessoa, para o cache durar)."""
    with _clients_lock:
        cached = _clients().get(row["id"])
        if cached and cached[0] == row["token_cifrado"]:
            return cached[1]
    try:
        token = _fernet().decrypt(row["token_cifrado"].encode()).decode()
    except InvalidToken:
        return None  # SECRET_KEY mudou: a pessoa precisa entrar de novo
    factory = current_app.config.get("TRELLO_FACTORY") or (
        lambda tok: TrelloClient(current_app.config["TRELLO_KEY"], tok))
    client = factory(token)
    with _clients_lock:
        _clients()[row["id"]] = (row["token_cifrado"], client)
    return client


# --- Quem esta usando --------------------------------------------------------


class Viewer:
    def __init__(self, trello, admin, user=None, via="web"):
        self.trello = trello
        self.admin = admin
        self.user = user  # dict serializado (None para administrador)
        self.via = via    # web | mcp

    @property
    def id(self):
        return self.user["id"] if self.user else "admin"

    def board_ids(self):
        """IDs dos quadros de que a pessoa participa no Trello (None = todos)."""
        if self.admin:
            return None
        return {b["id"] for b in self.trello.my_boards()}

    def can_see(self, board_id):
        ids = self.board_ids()
        return ids is None or board_id in ids

    def visible_boards(self):
        boards = db.list_boards()
        ids = self.board_ids()
        return boards if ids is None else [b for b in boards if b["id"] in ids]

    def as_json(self):
        if self.admin:
            name = current_app.config["APP_USER"]
            return {"id": "admin", "usuario": name, "nome": "Administrador", "username": name,
                    "iniciais": "AD", "avatar": None, "admin": True}
        return {**self.user, "usuario": self.user["nome"], "admin": False}


def _service_key_ok():
    import hmac
    expected = current_app.config.get("PRODUZIA_API_KEY") or ""
    got = request.headers.get("X-API-Key", "")
    return bool(expected) and bool(got) and hmac.compare_digest(got.encode(), expected.encode())


def _user_viewer(user_id, via):
    row = get_user(user_id)
    if not row:
        return None
    client = client_for(row)
    if not client:
        return None
    return Viewer(client, admin=False, user=serialize_user(row), via=via)


def current_viewer():
    """Quem fez a requisicao: pessoa logada pelo Trello, administrador ou o MCP."""
    if "viewer" in g:
        return g.viewer
    viewer = None
    if session.get("uid"):
        viewer = _user_viewer(session["uid"], "web")
        if not viewer:
            session.clear()
    elif session.get("user") and session.get("user") == current_app.config["APP_USER"]:
        viewer = Viewer(current_app.config["TRELLO"], admin=True)
    elif _service_key_ok():
        user_id = request.headers.get(USER_HEADER, "").strip()
        viewer = _user_viewer(user_id, "mcp") if user_id else Viewer(current_app.config["TRELLO"], True, via="mcp")
    g.viewer = viewer
    return viewer
