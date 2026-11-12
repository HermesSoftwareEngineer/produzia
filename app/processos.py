"""Mapeamento de processos: documento em Markdown e fluxograma (Mermaid ou HTML livre) por quadro."""
import hmac
import re
import uuid
from datetime import datetime, timezone

from flask import Blueprint, abort, current_app, jsonify, make_response, request, session

from . import db

bp = Blueprint("processos", __name__, url_prefix="/api/processos")

LIMITES = {"nome": 120, "descricao": 500, "categoria": 60}
MAX_MARKDOWN = 200 * 1024
MAX_FLUXOGRAMA = 50 * 1024
MAX_FLUXOGRAMA_HTML = 300 * 1024
TIPOS_FLUXOGRAMA = ("mermaid", "html")
MAX_BODY = 600 * 1024
CAMPOS = ("quadroId", "nome", "descricao", "categoria", "markdown", "fluxograma", "fluxogramaTipo")
MERMAID_INICIO = re.compile(
    r"^(flowchart|graph|sequenceDiagram|classDiagram(-v2)?|stateDiagram(-v2)?|erDiagram|journey|gantt|pie"
    r"|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|sankey(-beta)?|xychart(-beta)?"
    r"|block(-beta)?|packet(-beta)?|kanban|architecture(-beta)?|radar(-beta)?|treemap(-beta)?"
    r"|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|zenuml)\b"
)


# --- Autenticacao ------------------------------------------------------------


def service_key_ok():
    """Chave de servico (usada pelo servidor MCP). Chave vazia nunca vale."""
    expected = current_app.config.get("PRODUZIA_API_KEY") or ""
    got = request.headers.get("X-API-Key", "")
    return bool(expected) and bool(got) and hmac.compare_digest(got.encode(), expected.encode())


def session_ok():
    return session.get("user") == current_app.config["APP_USER"]


@bp.before_request
def _auth():
    if not (session_ok() or service_key_ok()):
        return jsonify(erro="Faça login."), 401
    if (request.content_length or 0) > MAX_BODY:
        return jsonify(erro="Conteúdo grande demais."), 413
    return None


def _fail(status, message):
    abort(make_response(jsonify(erro=message), status))


# --- Validacao ---------------------------------------------------------------


def mermaid_error(source):
    """Validacao leve: o desenho de verdade acontece no navegador."""
    lines = source.strip().splitlines()
    i = 0
    if lines and lines[0].strip() == "---":  # front-matter YAML (title, config)
        end = next((j for j in range(1, len(lines)) if lines[j].strip() == "---"), None)
        if end is None:
            return "Fluxograma: bloco --- de configuração sem fechamento."
        i = end + 1
    for line in lines[i:]:
        text = line.strip()
        if not text or text.startswith("%%"):
            continue
        if MERMAID_INICIO.match(text):
            return None
        return ("Fluxograma: a primeira linha deve declarar o tipo do diagrama Mermaid "
                "(ex.: 'flowchart TD', 'sequenceDiagram', 'stateDiagram-v2').")
    return "Fluxograma vazio."


def _text(body, key, required=False):
    value = body.get(key)
    if value is None:
        if required:
            _fail(400, f"Informe o campo {key}.")
        return None
    if not isinstance(value, str):
        _fail(400, f"O campo {key} deve ser texto.")
    return value


def clean(body, current=None):
    """Valida o corpo (completo na criacao, parcial na edicao) e devolve as colunas."""
    if not isinstance(body, dict):
        _fail(400, "Envie um objeto JSON.")
    creating = current is None
    out = {}

    if creating or "quadroId" in body:
        board_id = (_text(body, "quadroId", required=True) or "").strip()
        if not db.get_board(board_id):
            _fail(400, "Quadro não cadastrado no Produzia.")
        out["board_id"] = board_id

    if creating or "nome" in body:
        nome = (_text(body, "nome", required=True) or "").strip()
        if not nome:
            _fail(400, "Informe o nome do processo.")
        out["nome"] = nome

    if creating or "descricao" in body:
        out["descricao"] = (_text(body, "descricao") or "").strip()

    if creating or "categoria" in body:
        out["categoria"] = (_text(body, "categoria") or "").strip() or None

    for key, limit in LIMITES.items():
        if out.get(key) and len(out[key]) > limit:
            _fail(400, f"O campo {key} aceita até {limit} caracteres.")

    if "fluxogramaTipo" in body:
        tipo = (_text(body, "fluxogramaTipo") or "").strip().lower()
        if tipo not in TIPOS_FLUXOGRAMA:
            _fail(400, "fluxogramaTipo deve ser 'mermaid' ou 'html'.")
        out["fluxograma_tipo"] = tipo
    elif isinstance(body.get("fluxograma"), str) and body["fluxograma"].lstrip().startswith("<"):
        out["fluxograma_tipo"] = "html"  # HTML enviado sem informar o tipo
    elif creating:
        out["fluxograma_tipo"] = "mermaid"
    tipo = out.get("fluxograma_tipo") or (current or {}).get("fluxograma_tipo") or "mermaid"
    max_fluxo = MAX_FLUXOGRAMA_HTML if tipo == "html" else MAX_FLUXOGRAMA

    for key, limit in (("markdown", MAX_MARKDOWN), ("fluxograma", max_fluxo)):
        if creating or key in body:
            value = _text(body, key)
            value = value if value and value.strip() else None
            if value and len(value.encode("utf-8")) > limit:
                _fail(400, f"O campo {key} aceita até {limit // 1024} KB.")
            out[key] = value

    if out.get("fluxograma"):
        out["fluxograma"] = out["fluxograma"].strip() + "\n"
        if tipo == "mermaid":
            error = mermaid_error(out["fluxograma"])
            if error:
                _fail(400, error)
    elif "fluxograma_tipo" in out and (current or {}).get("fluxograma") and tipo == "mermaid":
        # Trocar para Mermaid sem enviar um fluxograma novo: o atual precisa ser Mermaid valido.
        error = mermaid_error(current["fluxograma"])
        if error:
            _fail(400, "Para trocar o tipo para Mermaid, envie também o fluxograma em Mermaid.")

    merged = {**(current or {}), **out}
    if not merged.get("markdown") and not merged.get("fluxograma"):
        _fail(400, "Informe o documento (markdown) ou o fluxograma (Mermaid ou HTML). Pelo menos um dos dois.")
    return out


# --- Banco -------------------------------------------------------------------


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def serialize(row, full=True):
    out = {
        "id": row["id"],
        "quadroId": row["board_id"],
        "quadroNome": row["quadro_nome"],
        "nome": row["nome"],
        "descricao": row["descricao"],
        "categoria": row["categoria"],
        "temDocumento": bool(row["markdown"]),
        "temFluxograma": bool(row["fluxograma"]),
        "fluxogramaTipo": row["fluxograma_tipo"],
        "criadoEm": row["criado_em"],
        "atualizadoEm": row["atualizado_em"],
        "atualizadoPor": row["atualizado_por"],
    }
    if full:
        out["markdown"] = row["markdown"]
        out["fluxograma"] = row["fluxograma"]
    return out


SELECT = ("SELECT p.*, b.nome AS quadro_nome FROM processos p LEFT JOIN boards b ON b.id = p.board_id")


def _row(processo_id):
    return db.get_db().execute(f"{SELECT} WHERE p.id = ?", (processo_id,)).fetchone()


def _get_or_404(processo_id):
    row = _row(processo_id)
    if not row:
        _fail(404, "Processo não encontrado.")
    return row


def _author():
    # Sessao do navegador tem prioridade; a chave de servico so e usada pelo MCP.
    return "web" if session_ok() else "mcp"


# --- Rotas -------------------------------------------------------------------


@bp.get("")
def listar():
    sql, args = SELECT, []
    quadro = request.args.get("quadro")
    if quadro:
        sql += " WHERE p.board_id = ?"
        args.append(quadro)
    sql += " ORDER BY p.categoria IS NULL, p.categoria COLLATE NOCASE, p.nome COLLATE NOCASE"
    rows = db.get_db().execute(sql, args).fetchall()
    return jsonify(processos=[serialize(r, full=False) for r in rows])


@bp.get("/<processo_id>")
def obter(processo_id):
    return jsonify(serialize(_get_or_404(processo_id)))


@bp.post("")
def criar():
    data = clean(request.get_json(silent=True))
    now = _now()
    processo_id = uuid.uuid4().hex
    db.get_db().execute(
        "INSERT INTO processos (id, board_id, nome, descricao, categoria, markdown, fluxograma,"
        " fluxograma_tipo, criado_em, atualizado_em, atualizado_por)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (processo_id, data["board_id"], data["nome"], data["descricao"], data["categoria"],
         data["markdown"], data["fluxograma"], data["fluxograma_tipo"], now, now, _author()),
    )
    return jsonify(serialize(_row(processo_id))), 201


@bp.route("/<processo_id>", methods=["PUT", "PATCH"])
def atualizar(processo_id):
    row = _get_or_404(processo_id)
    body = request.get_json(silent=True)
    if isinstance(body, dict) and not any(k in body for k in CAMPOS):
        _fail(400, "Nada para atualizar.")
    data = clean(body, current={"markdown": row["markdown"], "fluxograma": row["fluxograma"],
                                "fluxograma_tipo": row["fluxograma_tipo"]})
    data.update(atualizado_em=_now(), atualizado_por=_author())
    sets = ", ".join(f"{k} = ?" for k in data)
    db.get_db().execute(f"UPDATE processos SET {sets} WHERE id = ?", (*data.values(), processo_id))
    return jsonify(serialize(_row(processo_id)))


@bp.delete("/<processo_id>")
def excluir(processo_id):
    _get_or_404(processo_id)
    db.get_db().execute("DELETE FROM processos WHERE id = ?", (processo_id,))
    return "", 204
