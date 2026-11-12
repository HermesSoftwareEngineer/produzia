"""Transforma dados crus do Trello e do Power-Up em eventos e indicadores."""
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone

from .trello import SourceError

TRELLO_ID = re.compile(r"^[0-9a-f]{24}$")
NO_OWNER = "_sem"
STATUS_ORDER = {"atrasado": 0, "hoje": 1, "andamento": 2, "prazo": 3, None: 4}


# --- Utilidades de tempo -----------------------------------------------------


def parse_ts(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def card_created_at(card_id):
    try:
        return datetime.fromtimestamp(int(card_id[:8], 16), tz=timezone.utc)
    except (ValueError, TypeError):
        return None


def day_bounds(day, tz):
    start = datetime.combine(day, time.min, tzinfo=tz)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def iso_utc(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


# --- Coleta ------------------------------------------------------------------


class BoardData:
    def __init__(self, board):
        self.board = board
        self.lists = {}
        self.done = set(board.get("doneListIds") or [])
        self.members = []
        self.cards = {}
        self.items = []
        self.actions = []
        self.warnings = []

    def list_name(self, list_id):
        lst = self.lists.get(list_id)
        return lst["name"] if lst else None

    def card_ref(self, card_id, fallback_name=None):
        card = self.cards.get(card_id)
        return {
            "id": card_id,
            "nome": card["name"] if card else (fallback_name or "(card arquivado)"),
            "url": card["shortUrl"] if card else f"https://trello.com/c/{card_id}",
            "lista": self.list_name(card["idList"]) if card else None,
            "quadro": self.board["nome"],
            "quadroId": self.board["id"],
            "arquivado": card is None,
        }


def collect(boards, trello, powerup, since=None, before=None, actions_ttl=60, with_actions=True):
    """Busca em paralelo tudo que os relatorios precisam de cada quadro.

    Com with_actions=False nao busca as acoes (o calendario so precisa de cards e itens)."""
    def load(board):
        bd = BoardData(board)
        bid = board["id"]
        try:
            bd.lists = {l["id"]: l for l in trello.lists(bid)}
            bd.members = trello.members(bid)
            bd.cards = {c["id"]: c for c in trello.open_cards(bid)}
            if with_actions:
                bd.actions = trello.actions(bid, iso_utc(since), iso_utc(before), ttl=actions_ttl)
        except SourceError as exc:
            bd.warnings.append(f"{board['nome']}: {exc.message}")
        items, warning = powerup.items(bid)
        bd.items = items
        if warning:
            bd.warnings.append(f"{board['nome']}: {warning}")
        if not bd.done:
            bd.warnings.append(
                f"{board['nome']}: nenhuma lista marcada como concluída; só contam cards"
                " com a data de entrega marcada como concluída."
            )
        return bd

    if not boards:
        return []
    with ThreadPoolExecutor(max_workers=min(8, len(boards))) as pool:
        return list(pool.map(load, boards))


class People:
    def __init__(self):
        self.by_id = {}

    def add(self, member):
        if not member or not member.get("id"):
            return
        mid = member["id"]
        avatar = member.get("avatarUrl")
        current = self.by_id.get(mid, {})
        self.by_id[mid] = {
            "id": mid,
            "nome": member.get("fullName") or current.get("nome") or member.get("username") or "Membro",
            "username": member.get("username") or current.get("username"),
            "iniciais": member.get("initials") or current.get("iniciais") or "?",
            "avatar": f"{avatar}/50.png" if avatar else current.get("avatar"),
        }

    def get(self, mid):
        if mid == NO_OWNER:
            return {"id": NO_OWNER, "nome": "Sem responsável", "username": None,
                    "iniciais": "–", "avatar": None}
        return self.by_id.get(mid) or {"id": mid, "nome": "Membro desconhecido",
                                       "username": None, "iniciais": "?", "avatar": None}

    @classmethod
    def from_boards(cls, boards_data):
        people = cls()
        for bd in boards_data:
            for m in bd.members:
                people.add(m)
            for a in bd.actions:
                people.add(a.get("memberCreator"))
        return people


# --- Eventos -----------------------------------------------------------------


def item_owner(item):
    if item.get("responsavelId"):
        return item["responsavelId"]
    by = item.get("concluidoPor")
    if by and TRELLO_ID.match(by):
        return by
    return NO_OWNER


def extract_events(bd):
    """Lista de eventos datados (UTC) a partir das acoes e dos itens do Power-Up."""
    events = []
    for a in bd.actions:
        ts = parse_ts(a.get("date"))
        actor = a.get("idMemberCreator")
        data = a.get("data") or {}
        card_data = data.get("card") or {}
        card_id = card_data.get("id")
        if not ts or not card_id:
            continue
        ref = bd.card_ref(card_id, card_data.get("name"))
        kind = a.get("type")

        if kind == "commentCard":
            events.append({"tipo": "comentario", "ts": ts, "pessoas": [actor], "card": ref,
                           "texto": data.get("text", "")})
        elif kind == "createCard":
            events.append({"tipo": "card_criado", "ts": ts, "pessoas": [actor], "card": ref,
                           "lista": (data.get("list") or {}).get("name")})
        elif kind == "updateCard":
            after = (data.get("listAfter") or {})
            before = (data.get("listBefore") or {})
            moved_done = after.get("id") in bd.done and before.get("id") not in bd.done
            old = data.get("old") or {}
            due_done = old.get("dueComplete") is False and card_data.get("dueComplete") is True
            if moved_done or due_done:
                card = bd.cards.get(card_id)
                owners = (card or {}).get("idMembers") or [actor]
                via = f"movido para {after.get('name')}" if moved_done else "entrega marcada como concluída"
                events.append({"tipo": "card_concluido", "ts": ts, "pessoas": owners, "card": ref,
                               "via": via, "autor": actor})
            elif after.get("id"):
                events.append({"tipo": "movimento", "ts": ts, "pessoas": [actor], "card": ref,
                               "de": before.get("name"), "para": after.get("name")})

    return events


def _iso_day(value):
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def item_day(item, tz):
    """Dia em que o item conta: o prazo (data final, ou a de inicio se for a unica).

    Feito com prazo em D = concluido em D; em aberto com prazo em D = pendente de D.
    So um item feito sem nenhuma data usa o dia em que foi marcado, para nao sumir.
    """
    day = _iso_day(item.get("dataFim")) or _iso_day(item.get("dataInicio"))
    if day or not item.get("feito"):
        return day
    done_at = parse_ts(item.get("concluidoEm"))
    return done_at.astimezone(tz).date() if done_at else None


def done_items(bd, tz):
    """(dia, item) dos itens concluidos, pelo dia do prazo."""
    out = []
    for item in bd.items:
        if item.get("feito"):
            day = item_day(item, tz)
            if day:
                out.append((day, item))
    return out


def item_status(item, day):
    fim = item.get("dataFim")
    ini = item.get("dataInicio")
    d = day.isoformat()
    if fim and fim < d:
        return "atrasado"
    if fim == d:
        return "hoje"
    if ini and ini <= d and (not fim or d <= fim):
        return "andamento"
    return "prazo" if fim else None


def card_status(card, start, end):
    due = parse_ts(card.get("due"))
    if not due:
        return None
    if due < start:
        return "atrasado"
    if due < end:
        return "hoje"
    return "prazo"


def pending_items(bd, day, tz):
    """Itens em aberto com prazo no dia (pendentes) ou antes dele (atrasados), de cards abertos."""
    out = []
    for item in bd.items:
        if item.get("feito") or item["cardId"] not in bd.cards:
            continue
        prazo = item_day(item, tz)
        if prazo and prazo <= day:
            out.append(item)
    return out


def pending_cards(bd, end):
    out = []
    for card in bd.cards.values():
        if card["idList"] in bd.done or card.get("dueComplete"):
            continue
        created = card_created_at(card["id"])
        if created and created >= end:
            continue
        out.append(card)
    return out


# --- Resumo do dia -----------------------------------------------------------


def _local_time(ts, tz):
    return ts.astimezone(tz).strftime("%H:%M")


def day_summary(boards_data, day, tz):
    start, end = day_bounds(day, tz)
    people = People.from_boards(boards_data)
    rows = {}

    def row(pid):
        if pid not in rows:
            rows[pid] = {
                "pessoa": people.get(pid),
                "itensConcluidos": [], "itensPendentes": [],
                "cardsConcluidos": [], "cardsPendentes": [],
                "comentarios": [], "cardsCriados": [], "movimentacoes": [],
            }
        return rows[pid]

    for bd in boards_data:
        for ev in extract_events(bd):
            if not (start <= ev["ts"] < end):
                continue
            hora = _local_time(ev["ts"], tz)
            for pid in ev["pessoas"]:
                if not pid:
                    continue
                r = row(pid)
                if ev["tipo"] == "comentario":
                    r["comentarios"].append({"hora": hora, "card": ev["card"], "texto": ev["texto"]})
                elif ev["tipo"] == "card_criado":
                    r["cardsCriados"].append({"hora": hora, "card": ev["card"], "lista": ev["lista"]})
                elif ev["tipo"] == "movimento":
                    r["movimentacoes"].append({"hora": hora, "card": ev["card"],
                                               "de": ev["de"], "para": ev["para"]})
                elif ev["tipo"] == "card_concluido":
                    if any(c["card"]["id"] == ev["card"]["id"] for c in r["cardsConcluidos"]):
                        continue
                    r["cardsConcluidos"].append({"hora": hora, "card": ev["card"], "via": ev["via"]})

        for item_dia, item in done_items(bd, tz):
            if item_dia != day:
                continue
            pid = item_owner(item)
            autor = item.get("concluidoPor")
            row(pid)["itensConcluidos"].append({
                "hora": "", "card": bd.card_ref(item["cardId"]), "texto": item["texto"],
                "checklist": item.get("checklistNome"), "dataFim": item.get("dataFim"),
                "concluidoPor": people.get(autor)["nome"]
                if autor and autor != pid and TRELLO_ID.match(autor) else None,
            })

        for item in pending_items(bd, day, tz):
            row(item.get("responsavelId") or NO_OWNER)["itensPendentes"].append({
                "card": bd.card_ref(item["cardId"]), "texto": item["texto"],
                "checklist": item.get("checklistNome"), "dataInicio": item.get("dataInicio"),
                "dataFim": item.get("dataFim"), "status": item_status(item, day),
            })

        for card in pending_cards(bd, end):
            for pid in card.get("idMembers") or [NO_OWNER]:
                row(pid)["cardsPendentes"].append({
                    "card": bd.card_ref(card["id"]), "due": card.get("due"),
                    "status": card_status(card, start, end),
                })

    def by_status(entry):
        return (STATUS_ORDER.get(entry["status"], 9), entry.get("dataFim") or entry.get("due") or "9")

    result = []
    for r in rows.values():
        for key in ("itensConcluidos", "cardsConcluidos", "comentarios", "cardsCriados", "movimentacoes"):
            r[key].sort(key=lambda e: e["hora"])
        r["itensPendentes"].sort(key=by_status)
        r["cardsPendentes"].sort(key=by_status)
        r["totais"] = {
            "itensConcluidos": len(r["itensConcluidos"]),
            "itensPendentes": len(r["itensPendentes"]),
            "itensAtrasados": sum(1 for i in r["itensPendentes"] if i["status"] == "atrasado"),
            "cardsConcluidos": len(r["cardsConcluidos"]),
            "cardsPendentes": len(r["cardsPendentes"]),
            "cardsAtrasados": sum(1 for c in r["cardsPendentes"] if c["status"] == "atrasado"),
            "comentarios": len(r["comentarios"]),
            "cardsCriados": len(r["cardsCriados"]),
            "movimentacoes": len(r["movimentacoes"]),
        }
        t = r["totais"]
        r["atividade"] = t["itensConcluidos"] + t["cardsConcluidos"] + t["comentarios"] + t["cardsCriados"] + t["movimentacoes"]
        result.append(r)

    result.sort(key=lambda r: (r["pessoa"]["id"] == NO_OWNER, -r["atividade"],
                               -r["totais"]["itensPendentes"], r["pessoa"]["nome"].lower()))
    keys = ("itensConcluidos", "itensPendentes", "itensAtrasados", "cardsConcluidos",
            "cardsPendentes", "cardsAtrasados", "comentarios", "cardsCriados", "movimentacoes")
    totals = {k: sum(r["totais"][k] for r in result) for k in keys}
    return {"data": day.isoformat(), "pessoas": result, "totais": totals}


# --- Dashboard ---------------------------------------------------------------


def dashboard(boards_data, today, days, tz, now=None):
    now = now or datetime.now(timezone.utc)
    first_day = today - timedelta(days=days - 1)
    cur_start, _ = day_bounds(first_day, tz)
    prev_start, _ = day_bounds(first_day - timedelta(days=days), tz)
    _, cur_end = day_bounds(today, tz)
    people = People.from_boards(boards_data)

    day_keys = [(first_day + timedelta(days=i)).isoformat() for i in range(days)]
    series = {k: {"data": k, "cardsConcluidos": 0, "itensConcluidos": 0, "comentarios": 0,
                  "cardsCriados": 0} for k in day_keys}
    current = {"cardsConcluidos": 0, "itensConcluidos": 0, "comentarios": 0, "cardsCriados": 0}
    previous = dict.fromkeys(current, 0)
    ranking = {}
    boards_out = []
    hours = [0] * 24
    field = {"card_concluido": "cardsConcluidos", "comentario": "comentarios", "card_criado": "cardsCriados"}

    def rank(pid):
        if pid not in ranking:
            ranking[pid] = {"pessoa": people.get(pid), "cardsConcluidos": 0, "itensConcluidos": 0,
                            "comentarios": 0, "cardsCriados": 0, "itensPendentes": 0,
                            "itensAtrasados": 0, "cardsPendentes": 0, "cardsAtrasados": 0}
        return ranking[pid]

    totals = {"cardsAbertos": 0, "cardsAtrasados": 0, "itensPendentes": 0, "itensAtrasados": 0,
              "itensTotal": 0, "itensFeitos": 0}

    for bd in boards_data:
        b = {"id": bd.board["id"], "nome": bd.board["nome"], "url": bd.board["url"],
             "cardsAbertos": 0, "cardsAtrasados": 0, "cardsConcluidos": 0, "comentarios": 0,
             "itensFeitos": 0, "itensTotal": 0, "itensAtrasados": 0, "listas": []}
        seen_done = set()
        for ev in extract_events(bd):
            key = field.get(ev["tipo"])
            if not key:
                continue
            if ev["tipo"] == "card_concluido":
                dedupe = (ev["card"]["id"], ev["ts"].astimezone(tz).date())
                if dedupe in seen_done:
                    continue
                seen_done.add(dedupe)
            if prev_start <= ev["ts"] < cur_start:
                previous[key] += 1
            elif cur_start <= ev["ts"] < cur_end:
                current[key] += 1
                series[ev["ts"].astimezone(tz).date().isoformat()][key] += 1
                hours[ev["ts"].astimezone(tz).hour] += 1
                if key == "cardsConcluidos":
                    b["cardsConcluidos"] += 1
                if key == "comentarios":
                    b["comentarios"] += 1
                for pid in ev["pessoas"]:
                    if pid:
                        rank(pid)[key] += 1

        prev_first = first_day - timedelta(days=days)
        for item_dia, item in done_items(bd, tz):
            if prev_first <= item_dia < first_day:
                previous["itensConcluidos"] += 1
            elif first_day <= item_dia <= today:
                current["itensConcluidos"] += 1
                series[item_dia.isoformat()]["itensConcluidos"] += 1
                rank(item_owner(item))["itensConcluidos"] += 1

        _, today_end = day_bounds(today, tz)
        for card in pending_cards(bd, today_end):
            b["cardsAbertos"] += 1
            late = card_status(card, now, now + timedelta(seconds=1)) == "atrasado"
            b["cardsAtrasados"] += late
            for pid in card.get("idMembers") or []:
                rank(pid)["cardsPendentes"] += 1
                rank(pid)["cardsAtrasados"] += late

        for item in bd.items:
            if item["cardId"] not in bd.cards:
                continue
            b["itensTotal"] += 1
            if item.get("feito"):
                b["itensFeitos"] += 1
                continue
            late = item_status(item, today) == "atrasado"
            b["itensAtrasados"] += late
            pid = item.get("responsavelId") or NO_OWNER
            rank(pid)["itensPendentes"] += 1
            rank(pid)["itensAtrasados"] += late

        counts = {}
        for card in bd.cards.values():
            counts[card["idList"]] = counts.get(card["idList"], 0) + 1
        for lst in sorted(bd.lists.values(), key=lambda l: l.get("pos", 0)):
            if lst.get("closed") and not counts.get(lst["id"]):
                continue
            b["listas"].append({"id": lst["id"], "nome": lst["name"], "cards": counts.get(lst["id"], 0),
                                "concluida": lst["id"] in bd.done})

        for k in ("cardsAbertos", "cardsAtrasados", "itensTotal", "itensFeitos", "itensAtrasados"):
            totals[k] += b[k]
        totals["itensPendentes"] += b["itensTotal"] - b["itensFeitos"]
        boards_out.append(b)

    ranking_list = sorted(
        ranking.values(),
        key=lambda r: (r["pessoa"]["id"] == NO_OWNER,
                       -(r["itensConcluidos"] + r["cardsConcluidos"] * 3 + r["comentarios"]),
                       r["pessoa"]["nome"].lower()),
    )
    kpis = {**totals, **current,
            "taxaChecklist": round(100 * totals["itensFeitos"] / totals["itensTotal"]) if totals["itensTotal"] else None,
            "anterior": previous}
    return {"inicio": first_day.isoformat(), "fim": today.isoformat(), "dias": days,
            "kpis": kpis, "serie": list(series.values()), "ranking": ranking_list,
            "quadros": boards_out, "horas": hours}


def parse_day(value, tz):
    if not value:
        return datetime.now(tz).date()
    return date.fromisoformat(value)
