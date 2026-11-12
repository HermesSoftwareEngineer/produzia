"""Calendario: itens de checklist do Power-Up e cards com datas, por dia (prazo ou conclusao)."""
from datetime import date

from .gantt import _local_day, _valid_day
from .metrics import NO_OWNER, People

MAX_DIAS = 62
STATUS_ORDER = {"atrasado": 0, "hoje": 1, "pendente": 2, "concluido": 3}


def parse_range(inicio, fim):
    """Valida o intervalo pedido. Devolve (date, date) ou levanta ValueError com a mensagem."""
    try:
        start, end = date.fromisoformat(inicio or ""), date.fromisoformat(fim or "")
    except ValueError:
        raise ValueError("Datas inválidas. Use inicio e fim no formato AAAA-MM-DD.") from None
    if end < start:
        raise ValueError("A data final é anterior à inicial.")
    if (end - start).days + 1 > MAX_DIAS:
        raise ValueError(f"Intervalo grande demais (máximo de {MAX_DIAS} dias).")
    return start, end


def _status(concluido, prazo, hoje):
    if concluido:
        return "concluido"
    if prazo and prazo < hoje:
        return "atrasado"
    if prazo == hoje:
        return "hoje"
    return "pendente"


def _tarefas(bd, people, tz, hoje):
    """Todas as tarefas datadas de um quadro (itens de cards abertos e cards com datas)."""
    out = []
    for item in bd.items:
        card = bd.cards.get(item.get("cardId"))
        if not card:
            continue
        inicio = _valid_day(item.get("dataInicio"))
        prazo = _valid_day(item.get("dataFim")) or inicio
        feito = bool(item.get("feito"))
        owner = item.get("responsavelId")
        out.append({
            "id": f"item:{item.get('id')}",
            "tipo": "item",
            "titulo": item.get("texto") or "",
            "card": bd.card_ref(card["id"]),
            "checklist": item.get("checklistNome"),
            "responsaveis": [people.get(owner)] if owner else [],
            "inicio": inicio,
            "prazo": prazo,
            "concluido": feito,
            "concluidoEm": _local_day(item.get("concluidoEm"), tz) if feito else None,
            "status": _status(feito, prazo, hoje),
        })

    for card in bd.cards.values():
        inicio = _local_day(card.get("start"), tz)
        prazo = _local_day(card.get("due"), tz) or inicio
        if not prazo:
            continue
        done = card.get("idList") in bd.done or bool(card.get("dueComplete"))
        out.append({
            "id": f"card:{card['id']}",
            "tipo": "card",
            "titulo": card.get("name") or "",
            "card": bd.card_ref(card["id"]),
            "checklist": None,
            "responsaveis": [people.get(mid) for mid in card.get("idMembers") or []],
            "inicio": inicio,
            "prazo": prazo,
            "concluido": done,
            # O Trello nao guarda quando o card foi concluido sem olhar as acoes.
            "concluidoEm": None,
            "status": _status(done, prazo, hoje),
        })
    return out


def _sort_key(t):
    return (t["prazo"] or "9999", STATUS_ORDER[t["status"]], t["titulo"].lower())


def build(boards_data, inicio, fim, tz, hoje):
    """Resposta de /api/calendario. `inicio`, `fim` e `hoje` sao dates no fuso do app."""
    people = People.from_boards(boards_data)
    a, b, h = inicio.isoformat(), fim.isoformat(), hoje.isoformat()
    tarefas, atrasadas = [], []
    for bd in boards_data:
        for t in _tarefas(bd, people, tz, h):
            no_prazo = t["prazo"] and a <= t["prazo"] <= b
            na_conclusao = t["concluidoEm"] and a <= t["concluidoEm"] <= b
            if no_prazo or na_conclusao:
                tarefas.append(t)
            if t["status"] == "atrasado":
                atrasadas.append(t)
    tarefas.sort(key=_sort_key)
    atrasadas.sort(key=_sort_key)

    used = {}
    for t in tarefas + atrasadas:
        for p in t["responsaveis"] or [people.get(NO_OWNER)]:
            used[p["id"]] = p
    pessoas = sorted(used.values(), key=lambda p: (p["id"] == NO_OWNER, p["nome"].lower()))

    return {
        "inicio": a,
        "fim": b,
        "hoje": h,
        "tarefas": tarefas,
        "atrasadas": atrasadas,
        "pessoas": pessoas,
        "totais": {
            "tarefas": len(tarefas),
            "concluidas": sum(1 for t in tarefas if t["concluido"]),
            "atrasadas": len(atrasadas),
        },
    }

