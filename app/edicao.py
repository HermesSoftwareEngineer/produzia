"""Edicao de cards e itens de checklist pelo Produzia (cronograma, resumo, calendario...).

Os campos do card vao para a API do Trello com o token de quem esta logado (o administrador usa o
token do servidor). Os itens de checklist sao do Power-Up (trello-power): vao para a API dele com a
chave de servico, depois de o Produzia conferir que a pessoa pode editar o card no Trello.

Antes de qualquer escrita: o card tem de ser de um quadro cadastrado que a pessoa enxerga e ela nao
pode ser so observadora do quadro no Trello.
"""
import re
from datetime import date, datetime, time
from functools import wraps
from zoneinfo import ZoneInfo

from flask import Blueprint, current_app, jsonify, request

from . import accounts, db
from .metrics import People, parse_ts
from .trello import SourceError

bp = Blueprint("edicao", __name__, url_prefix="/api")

TRELLO_ID = re.compile(r"^[0-9a-f]{24}$")
OWN_ID = re.compile(r"^[0-9a-f]{32}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_NAME = 16384
MAX_DESC = 16384
MAX_COMMENT = 16384
DEFAULT_HOUR = time(12, 0)  # meio-dia local: a data nao muda de dia em nenhum fuso do Brasil


class EditError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


@bp.errorhandler(EditError)
def edit_error(error):
    return jsonify(erro=error.message), error.status


def _tz():
    return ZoneInfo(current_app.config["TIMEZONE"])


def _powerup():
    return current_app.config["POWERUP"]


def web_only(view):
    """Escritas so pela tela (o MCP nao edita cards por aqui)."""
    @wraps(view)
    def wrapper(*args, **kwargs):
        v = accounts.current_viewer()
        if not v:
            return jsonify(erro="Faça login."), 401
        if v.via != "web":
            return jsonify(erro="Disponível só pela tela do Produzia."), 403
        return view(*args, **kwargs)
    return wrapper


def _body():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise EditError(400, "Envie um objeto JSON.")
    return body


def _check_id(value, label="Card", pattern=TRELLO_ID):
    if not isinstance(value, str) or not pattern.match(value):
        raise EditError(404, f"{label} não encontrado.")
    return value


def editable_board(board_id, viewer=None):
    """(viewer, quadro) se a pessoa pode editar o quadro; senao 403/404 com mensagem clara."""
    viewer = viewer or accounts.current_viewer()
    board = db.get_board(board_id) if isinstance(board_id, str) and TRELLO_ID.match(board_id) else None
    if not board or not viewer.can_see(board_id):
        raise EditError(404, "Quadro não cadastrado no Produzia ou sem acesso.")
    if not viewer.admin:
        mine = next((m for m in viewer.trello.memberships(board_id) if m.get("idMember") == viewer.id), None)
        if mine and mine.get("memberType") == "observer":
            raise EditError(403, "Você é observador deste quadro no Trello e não pode editar.")
    return viewer, board


def editable_card(card_id):
    """(viewer, quadro) se a pessoa pode editar o card; senao 403/404 com mensagem clara."""
    _check_id(card_id)
    viewer = accounts.current_viewer()
    try:
        board_id = viewer.trello.card_board(card_id)
    except SourceError as exc:
        if exc.status == 404:
            raise EditError(404, "Card não encontrado no Trello (ou sem acesso).") from exc
        raise
    try:
        return editable_board(board_id, viewer)
    except EditError as exc:
        if exc.status == 404:
            raise EditError(404, "O card é de um quadro não cadastrado no Produzia ou sem acesso.") from exc
        raise


def _forget(viewer, board_id):
    viewer.trello.forget_board(board_id)
    _powerup().forget_board(board_id)


# --- Datas ---------------------------------------------------------------------


def _parse_day(value, label):
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not DATE.match(value):
        raise EditError(400, f"{label}: data inválida. Use AAAA-MM-DD.")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise EditError(400, f"{label}: data inválida. Use AAAA-MM-DD.")


def local_day(value, tz):
    ts = parse_ts(value)
    return ts.astimezone(tz).date().isoformat() if ts else None


def to_trello_ts(day, previous, tz):
    """Data local -> instante do Trello, mantendo a hora que o card ja tinha (ou meio-dia)."""
    if day is None:
        return None
    prev = parse_ts(previous)
    hour = prev.astimezone(tz).timetz().replace(tzinfo=None) if prev else DEFAULT_HOUR
    return datetime.combine(day, hour, tz).astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")


# --- Serializacao ----------------------------------------------------------------


def serialize_card(card, tz):
    return {
        "id": card["id"],
        "nome": card.get("name") or "",
        "descricao": card.get("desc") or "",
        "start": card.get("start"),
        "due": card.get("due"),
        "inicio": local_day(card.get("start"), tz),
        "prazo": local_day(card.get("due"), tz),
        "concluido": bool(card.get("dueComplete")),
        "listaId": card.get("idList"),
        "membros": card.get("idMembers") or [],
        "etiquetas": card.get("idLabels") or [],
        "url": card.get("shortUrl") or f"https://trello.com/c/{card['id']}",
        "quadroId": card.get("idBoard"),
        "arquivado": bool(card.get("closed")),
    }


def serialize_comment(action, people):
    creator = action.get("memberCreator") or {"id": action.get("idMemberCreator")}
    people.add(creator)
    return {
        "id": action["id"],
        "texto": (action.get("data") or {}).get("text") or "",
        "data": action.get("date"),
        "editado": bool((action.get("data") or {}).get("dateLastEdited")),
        "autor": people.get(creator.get("id")),
    }


def _my_trello_id(viewer):
    if not viewer.admin:
        return viewer.id
    try:
        return viewer.trello.my_id()
    except SourceError:
        return None


# --- Card ----------------------------------------------------------------------


@bp.get("/cards/<card_id>")
@web_only
def card_detail(card_id):
    viewer, board = editable_card(card_id)
    trello, tz = viewer.trello, _tz()
    bid = board["id"]
    card = trello.card(card_id)
    people = People()
    for m in trello.members(bid):
        people.add(m)
    membros = sorted(people.by_id.values(), key=lambda p: p["nome"].lower())
    comentarios = [serialize_comment(a, people) for a in trello.comments(card_id)]
    checklists, aviso = [], None
    try:
        checklists = _powerup().card_checklists(card_id)
    except SourceError as exc:
        aviso = f"Checklists indisponíveis: {exc.message}"
    done = set(board.get("doneListIds") or [])
    return jsonify(
        card=serialize_card(card, tz),
        quadro={"id": bid, "nome": board["nome"], "url": board["url"]},
        listas=[{"id": l["id"], "nome": l["name"], "concluida": l["id"] in done}
                for l in sorted(trello.lists(bid), key=lambda l: l.get("pos", 0)) if not l.get("closed")],
        membros=membros,
        etiquetas=[{"id": l["id"], "nome": l.get("name") or "", "cor": l.get("color")} for l in trello.labels(bid)],
        checklists=checklists,
        comentarios=comentarios,
        euId=_my_trello_id(viewer),
        avisos=[aviso] if aviso else [],
    )


@bp.patch("/cards/<card_id>")
@web_only
def card_update(card_id):
    viewer, board = editable_card(card_id)
    trello, tz = viewer.trello, _tz()
    body = _body()
    fields = {}
    if "nome" in body:
        nome = body["nome"]
        if not isinstance(nome, str) or not nome.strip():
            raise EditError(400, "Escreva o título do card.")
        if len(nome) > MAX_NAME:
            raise EditError(400, "Título longo demais.")
        fields["name"] = nome.strip()
    if "descricao" in body:
        desc = body["descricao"] if body["descricao"] is not None else ""
        if not isinstance(desc, str) or len(desc) > MAX_DESC:
            raise EditError(400, f"A descrição pode ter até {MAX_DESC} caracteres.")
        fields["desc"] = desc
    if "concluido" in body:
        if not isinstance(body["concluido"], bool):
            raise EditError(400, "O campo concluido deve ser verdadeiro ou falso.")
        fields["dueComplete"] = body["concluido"]
    if "arquivado" in body:
        if not isinstance(body["arquivado"], bool):
            raise EditError(400, "O campo arquivado deve ser verdadeiro ou falso.")
        fields["closed"] = body["arquivado"]
    if "listaId" in body:
        lists = {l["id"]: l for l in trello.lists(board["id"])}
        target = lists.get(body["listaId"])
        if not target or target.get("closed"):
            raise EditError(400, "Lista inválida para este quadro.")
        fields["idList"] = target["id"]
    anterior = None
    if "inicio" in body or "prazo" in body:
        current = trello.card(card_id)
        # Para o "Desfazer" da tela: as datas como estavam antes desta alteracao.
        anterior = {"inicio": local_day(current.get("start"), tz), "prazo": local_day(current.get("due"), tz)}

        def current_day(key):
            value = local_day(current.get(key), tz)
            return date.fromisoformat(value) if value else None

        ini_day = _parse_day(body["inicio"], "Início") if "inicio" in body else current_day("start")
        fim_day = _parse_day(body["prazo"], "Prazo") if "prazo" in body else current_day("due")
        if ini_day and fim_day and ini_day > fim_day:
            # Reagendar so o prazo (resumo do dia): o inicio acompanha em vez de dar erro.
            if body.get("ajustarInicio") and "inicio" not in body:
                fields["start"] = to_trello_ts(fim_day, current.get("start"), tz)
            else:
                raise EditError(400, "O início não pode ser depois do prazo.")
        if "inicio" in body:
            fields["start"] = to_trello_ts(ini_day, current.get("start"), tz)
        if "prazo" in body:
            fields["due"] = to_trello_ts(fim_day, current.get("due"), tz)
    if not fields:
        raise EditError(400, "Nenhum campo para alterar.")
    updated = trello.update_card(card_id, fields)
    _forget(viewer, board["id"])
    out = serialize_card(updated, tz)
    if anterior:
        out["anterior"] = anterior
    return jsonify(out)


def _open_lists(trello, board):
    done = set(board.get("doneListIds") or [])
    return [{"id": l["id"], "nome": l["name"], "concluida": l["id"] in done}
            for l in sorted(trello.lists(board["id"]), key=lambda l: l.get("pos", 0)) if not l.get("closed")]


@bp.get("/quadros/<board_id>/edicao")
@web_only
def board_options(board_id):
    """Listas, membros e cards abertos de um quadro: o que a tela precisa para criar tarefas."""
    viewer, board = editable_board(board_id)
    trello = viewer.trello
    people = People()
    for m in trello.members(board["id"]):
        people.add(m)
    lists = _open_lists(trello, board)
    order = {l["id"]: i for i, l in enumerate(lists)}
    cards = [{"id": c["id"], "nome": c.get("name") or "", "listaId": c.get("idList")}
             for c in trello.open_cards(board["id"]) if c.get("idList") in order]
    cards.sort(key=lambda c: (order[c["listaId"]], c["nome"].lower()))
    return jsonify(
        quadro={"id": board["id"], "nome": board["nome"]},
        listas=lists,
        membros=sorted(people.by_id.values(), key=lambda p: p["nome"].lower()),
        cards=cards,
        euId=_my_trello_id(viewer),
    )


@bp.post("/quadros/<board_id>/cards")
@web_only
def card_create(board_id):
    viewer, board = editable_board(board_id)
    trello, tz = viewer.trello, _tz()
    body = _body()
    nome = body.get("nome")
    if not isinstance(nome, str) or not nome.strip():
        raise EditError(400, "Escreva o título do card.")
    if len(nome) > MAX_NAME:
        raise EditError(400, "Título longo demais.")
    lists = {l["id"]: l for l in _open_lists(trello, board)}
    if body.get("listaId") not in lists:
        raise EditError(400, "Escolha uma lista deste quadro.")
    fields = {"idList": body["listaId"], "name": nome.strip(), "pos": "bottom"}
    desc = body.get("descricao")
    if desc:
        if not isinstance(desc, str) or len(desc) > MAX_DESC:
            raise EditError(400, f"A descrição pode ter até {MAX_DESC} caracteres.")
        fields["desc"] = desc
    ini_day = _parse_day(body.get("inicio"), "Início")
    fim_day = _parse_day(body.get("prazo"), "Prazo")
    if ini_day and fim_day and ini_day > fim_day:
        raise EditError(400, "O início não pode ser depois do prazo.")
    if ini_day:
        fields["start"] = to_trello_ts(ini_day, None, tz)
    if fim_day:
        fields["due"] = to_trello_ts(fim_day, None, tz)
    membros = body.get("membros") or []
    if not isinstance(membros, list):
        raise EditError(400, "Membros inválidos.")
    for mid in membros:
        _board_member(trello, board["id"], _check_id(mid, "Membro"))
    if membros:
        fields["idMembers"] = ",".join(membros)
    card = trello.create_card(fields)
    _forget(viewer, board["id"])
    return jsonify(serialize_card(card, tz)), 201


def _board_member(trello, board_id, member_id):
    if not any(m["id"] == member_id for m in trello.members(board_id)):
        raise EditError(400, "Essa pessoa não é membro do quadro.")


@bp.post("/cards/<card_id>/membros")
@web_only
def member_add(card_id):
    viewer, board = editable_card(card_id)
    member_id = _check_id(_body().get("id"), "Membro")
    _board_member(viewer.trello, board["id"], member_id)
    viewer.trello.add_member(card_id, member_id)
    _forget(viewer, board["id"])
    return jsonify(ok=True)


@bp.delete("/cards/<card_id>/membros/<member_id>")
@web_only
def member_remove(card_id, member_id):
    viewer, board = editable_card(card_id)
    _check_id(member_id, "Membro")
    viewer.trello.remove_member(card_id, member_id)
    _forget(viewer, board["id"])
    return jsonify(ok=True)


def _board_label(trello, board_id, label_id):
    if not any(l["id"] == label_id for l in trello.labels(board_id)):
        raise EditError(400, "Etiqueta inválida para este quadro.")


@bp.post("/cards/<card_id>/etiquetas")
@web_only
def label_add(card_id):
    viewer, board = editable_card(card_id)
    label_id = _check_id(_body().get("id"), "Etiqueta")
    _board_label(viewer.trello, board["id"], label_id)
    viewer.trello.add_label(card_id, label_id)
    _forget(viewer, board["id"])
    return jsonify(ok=True)


@bp.delete("/cards/<card_id>/etiquetas/<label_id>")
@web_only
def label_remove(card_id, label_id):
    viewer, board = editable_card(card_id)
    _check_id(label_id, "Etiqueta")
    viewer.trello.remove_label(card_id, label_id)
    _forget(viewer, board["id"])
    return jsonify(ok=True)


# --- Comentarios -------------------------------------------------------------------


def _comment_text(body):
    texto = body.get("texto")
    if not isinstance(texto, str) or not texto.strip():
        raise EditError(400, "Escreva o comentário.")
    if len(texto) > MAX_COMMENT:
        raise EditError(400, "Comentário longo demais.")
    return texto.strip()


def _own_comment(viewer, card_id, action_id):
    _check_id(action_id, "Comentário")
    try:
        action = viewer.trello.action(action_id)
    except SourceError as exc:
        if exc.status == 404:
            raise EditError(404, "Comentário não encontrado.") from exc
        raise
    if action.get("type") != "commentCard" or ((action.get("data") or {}).get("card") or {}).get("id") != card_id:
        raise EditError(404, "Comentário não encontrado.")
    if action.get("idMemberCreator") != _my_trello_id(viewer):
        raise EditError(403, "Você só pode alterar os próprios comentários.")


@bp.post("/cards/<card_id>/comentarios")
@web_only
def comment_add(card_id):
    viewer, board = editable_card(card_id)
    action = viewer.trello.add_comment(card_id, _comment_text(_body()))
    _forget(viewer, board["id"])
    return jsonify(serialize_comment(action, People())), 201


@bp.patch("/cards/<card_id>/comentarios/<action_id>")
@web_only
def comment_edit(card_id, action_id):
    viewer, board = editable_card(card_id)
    texto = _comment_text(_body())
    _own_comment(viewer, card_id, action_id)
    viewer.trello.edit_comment(action_id, texto)
    _forget(viewer, board["id"])
    return jsonify(ok=True, texto=texto)


@bp.delete("/cards/<card_id>/comentarios/<action_id>")
@web_only
def comment_delete(card_id, action_id):
    viewer, board = editable_card(card_id)
    _own_comment(viewer, card_id, action_id)
    viewer.trello.delete_comment(action_id)
    _forget(viewer, board["id"])
    return "", 204


# --- Itens de checklist (Power-Up) --------------------------------------------------


def _card_lists(card_id):
    return _powerup().card_checklists(card_id)


def _item_of_card(card_id, item_id):
    _check_id(item_id, "Item", OWN_ID)
    for checklist in _card_lists(card_id):
        for item in checklist.get("itens") or []:
            if item.get("id") == item_id:
                return item
    raise EditError(404, "Item não encontrado neste card.")


def _item_fields(body, partial):
    out = {}
    if "texto" in body or not partial:
        texto = body.get("texto")
        if not isinstance(texto, str) or not texto.strip():
            raise EditError(400, "Escreva o texto do item.")
        out["texto"] = texto.strip()
    for key, label in (("dataInicio", "Início"), ("dataFim", "Prazo")):
        if key in body:
            day = _parse_day(body[key], label)
            out[key] = day.isoformat() if day else None
    if "responsavelId" in body:
        rid = body["responsavelId"]
        out["responsavelId"] = _check_id(rid, "Responsável") if rid else None
    if "feito" in body:
        if not isinstance(body["feito"], bool):
            raise EditError(400, "O campo feito deve ser verdadeiro ou falso.")
        out["feito"] = body["feito"]
    if partial and not out:
        raise EditError(400, "Nenhum campo para alterar.")
    return out


def _check_owner(viewer, board, fields):
    if fields.get("responsavelId"):
        _board_member(viewer.trello, board["id"], fields["responsavelId"])


@bp.patch("/cards/<card_id>/itens/<item_id>")
@web_only
def item_update(card_id, item_id):
    viewer, board = editable_card(card_id)
    fields = _item_fields(_body(), partial=True)
    _item_of_card(card_id, item_id)
    _check_owner(viewer, board, fields)
    item = _powerup().update_item(item_id, fields)
    _forget(viewer, board["id"])
    return jsonify(item)


@bp.delete("/cards/<card_id>/itens/<item_id>")
@web_only
def item_delete(card_id, item_id):
    viewer, board = editable_card(card_id)
    _item_of_card(card_id, item_id)
    _powerup().delete_item(item_id)
    _forget(viewer, board["id"])
    return "", 204


@bp.post("/cards/<card_id>/checklists")
@web_only
def checklist_add(card_id):
    viewer, board = editable_card(card_id)
    nome = _body().get("nome") or "Checklist"
    if not isinstance(nome, str) or not nome.strip():
        raise EditError(400, "Escreva o nome da checklist.")
    checklist = _powerup().create_checklist(card_id, board["id"], nome.strip())
    _forget(viewer, board["id"])
    return jsonify(checklist), 201


@bp.post("/cards/<card_id>/checklists/<checklist_id>/itens")
@web_only
def item_add(card_id, checklist_id):
    viewer, board = editable_card(card_id)
    _check_id(checklist_id, "Checklist", OWN_ID)
    if not any(c.get("id") == checklist_id for c in _card_lists(card_id)):
        raise EditError(404, "Checklist não encontrada neste card.")
    fields = _item_fields(_body(), partial=False)
    fields.pop("feito", None)
    _check_owner(viewer, board, fields)
    item = _powerup().create_item(checklist_id, fields)
    _forget(viewer, board["id"])
    return jsonify(item), 201
