import json
import sqlite3
from datetime import datetime, timezone

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS boards (
    id             TEXT PRIMARY KEY,
    nome           TEXT NOT NULL,
    url            TEXT NOT NULL,
    done_list_ids  TEXT NOT NULL DEFAULT '[]',
    criado_em      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processos (
    id             TEXT PRIMARY KEY,
    board_id       TEXT NOT NULL,
    nome           TEXT NOT NULL,
    descricao      TEXT NOT NULL DEFAULT '',
    categoria      TEXT,
    markdown       TEXT,
    fluxograma     TEXT,
    criado_em      TEXT NOT NULL,
    atualizado_em  TEXT NOT NULL,
    atualizado_por TEXT NOT NULL DEFAULT 'web'
);
CREATE INDEX IF NOT EXISTS processos_board ON processos (board_id);
"""


def _connect(path):
    conn = sqlite3.connect(path, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(path):
    conn = _connect(path)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
    finally:
        conn.close()


def get_db():
    if "db" not in g:
        g.db = _connect(current_app.config["DATABASE_PATH"])
    return g.db


def close_db(_exc=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def serialize_board(row):
    return {
        "id": row["id"],
        "nome": row["nome"],
        "url": row["url"],
        "doneListIds": json.loads(row["done_list_ids"]),
        "criadoEm": row["criado_em"],
    }


def list_boards():
    rows = get_db().execute("SELECT * FROM boards ORDER BY nome COLLATE NOCASE").fetchall()
    return [serialize_board(r) for r in rows]


def get_board(board_id):
    row = get_db().execute("SELECT * FROM boards WHERE id = ?", (board_id,)).fetchone()
    return serialize_board(row) if row else None


def save_board(board_id, nome, url, done_list_ids):
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    get_db().execute(
        "INSERT INTO boards (id, nome, url, done_list_ids, criado_em) VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, url = excluded.url,"
        " done_list_ids = excluded.done_list_ids",
        (board_id, nome, url, json.dumps(done_list_ids), now),
    )


def delete_board(board_id):
    get_db().execute("DELETE FROM boards WHERE id = ?", (board_id,))
