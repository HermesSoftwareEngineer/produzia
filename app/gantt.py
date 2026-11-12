"""Cronograma (Gantt) de um quadro: listas, cards com datas e itens de checklist do Power-Up."""
from datetime import date, datetime

from .metrics import People, parse_ts


def today(tz):
    return datetime.now(tz).date()


def _local_day(value, tz):
    """Data local (AAAA-MM-DD) de um instante ISO do Trello."""
    ts = parse_ts(value)
    return ts.astimezone(tz).date().isoformat() if ts else None


def _valid_day(value):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError:
        return None


def _range(start, end):
    """Intervalo de uma barra. Com uma data so, vira um marco de um dia."""
    if start and end:
        if end < start:
            start, end = end, start
        return start, end, False
    if start or end:
        day = start or end
        return day, day, True
    return None, None, False


def _status(done, start, end, hoje):
    if done:
        return "concluido"
    if not end:
        return "semdata"
    if end < hoje:
        return "atrasado"
    if start and start > hoje:
        return "futuro"
    return "andamento"


def build(board, lists, members, cards, items, tz, day):
    """Monta a resposta de /api/gantt. `day` (hoje) e uma date no fuso do app."""
    hoje = day.isoformat()
    done_ids = set(board.get("doneListIds") or [])
    people = People()
    for m in members:
        people.add(m)

    items_by_card = {}
    for item in items:
        items_by_card.setdefault(item.get("cardId"), []).append(item)

    used_people = set()
    out_cards = []
    for card in cards:
        in_done = card.get("idList") in done_ids
        card_done = in_done or bool(card.get("dueComplete"))

        out_items = []
        for item in items_by_card.get(card["id"], []):
            ini, fim, marco = _range(_valid_day(item.get("dataInicio")), _valid_day(item.get("dataFim")))
            feito = bool(item.get("feito"))
            owner = item.get("responsavelId")
            if owner:
                used_people.add(owner)
            out_items.append({
                "id": item.get("id"),
                "texto": item.get("texto") or "",
                "checklist": item.get("checklistNome"),
                "dataInicio": _valid_day(item.get("dataInicio")),
                "dataFim": _valid_day(item.get("dataFim")),
                "inicio": ini,
                "fim": fim,
                "marco": marco,
                "responsavel": owner,
                "feito": feito,
                "status": _status(feito or card_done, ini, fim, hoje),
            })
        out_items.sort(key=lambda i: (i["checklist"] or "", i["inicio"] or "9999", i["texto"].lower()))

        start = _local_day(card.get("start"), tz)
        due = _local_day(card.get("due"), tz)
        ini, fim, marco = _range(start, due)
        derivado = False
        if not ini:
            starts = [i["inicio"] for i in out_items if i["inicio"]]
            ends = [i["fim"] for i in out_items if i["fim"]]
            if starts:
                ini, fim, derivado = min(starts), max(ends), True

        membros = card.get("idMembers") or []
        used_people.update(membros)
        feitos = sum(1 for i in out_items if i["feito"])
        out_cards.append({
            "id": card["id"],
            "nome": card.get("name") or "",
            "listaId": card.get("idList"),
            "url": card.get("shortUrl") or f"https://trello.com/c/{card['id']}",
            "membros": membros,
            "start": card.get("start"),
            "due": card.get("due"),
            "dueComplete": bool(card.get("dueComplete")),
            "emListaConcluida": in_done,
            "concluido": card_done,
            "inicio": ini,
            "fim": fim,
            "marco": marco,
            "derivado": derivado,
            "status": _status(card_done, ini, fim, hoje),
            "itensTotal": len(out_items),
            "itensFeitos": feitos,
            "itens": out_items,
        })

    card_lists = {c["listaId"] for c in out_cards}
    ordered = sorted(lists, key=lambda l: l.get("pos", 0))
    out_lists = [
        {"id": l["id"], "nome": l["name"], "concluida": l["id"] in done_ids,
         "arquivada": bool(l.get("closed"))}
        for l in ordered if not l.get("closed") or l["id"] in card_lists
    ]
    position = {l["id"]: i for i, l in enumerate(out_lists)}
    out_cards.sort(key=lambda c: (position.get(c["listaId"], len(position)),
                                  c["inicio"] or "9999", c["nome"].lower()))

    starts = [x["inicio"] for c in out_cards for x in [c, *c["itens"]] if x["inicio"]]
    ends = [x["fim"] for c in out_cards for x in [c, *c["itens"]] if x["fim"]]
    intervalo = {"inicio": min(starts), "fim": max(ends)} if starts else None

    return {
        "quadro": {"id": board["id"], "nome": board["nome"], "url": board["url"]},
        "hoje": hoje,
        "listas": out_lists,
        "cards": out_cards,
        "pessoas": sorted((people.get(pid) for pid in used_people), key=lambda p: p["nome"].lower()),
        "intervalo": intervalo,
    }
