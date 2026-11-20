"""Clientes HTTP do Trello e do Power-Up de checklists."""
import requests

from .cache import TTLCache

TRELLO_API = "https://api.trello.com/1"
ACTION_FILTER = "commentCard,updateCard,createCard"
PAGE = 1000


class SourceError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.message = message
        self.status = status


def write_error(status, text):
    """Traduz o erro de uma escrita no Trello numa mensagem clara (sem repassar a URL)."""
    low = (text or "").lower()
    if status == 401:
        if "invalid token" in low or "expired" in low:
            return SourceError("A autorização do Trello não vale mais. Entre de novo com sua conta.", 401)
        # Token so de leitura: 403 aqui (401 levaria a tela de volta ao login).
        return SourceError("Sua autorização do Trello é só de leitura. Saia e entre de novo com o Trello "
                           "para permitir edições pelo Produzia.", 403)
    if status == 403:
        return SourceError("O Trello não permitiu esta alteração (sem permissão neste quadro).", 403)
    if status == 404:
        return SourceError("Card ou recurso não encontrado no Trello (ou sem acesso).", 404)
    if status == 429:
        return SourceError("O Trello limitou as requisições. Espere alguns segundos e tente de novo.", 429)
    if status == 400:
        return SourceError(f"O Trello recusou a alteração: {(text or '')[:200]}", 400)
    return SourceError(f"Trello respondeu {status}.", 502)


class TrelloClient:
    def __init__(self, key, token, session=None):
        self.key = key
        self.token = token
        self.http = session or requests.Session()
        self.cache = TTLCache()

    def configured(self):
        return bool(self.key and self.token)

    def _get(self, path, **params):
        if not self.configured():
            raise SourceError("Credenciais do Trello não configuradas no servidor.", 503)
        params.update(key=self.key, token=self.token)
        try:
            resp = self.http.get(f"{TRELLO_API}{path}", params=params, timeout=30)
        except requests.RequestException as exc:
            # Nunca repasse str(exc): a URL carrega a key e o token do Trello.
            raise SourceError(f"Falha ao falar com o Trello ({type(exc).__name__}).") from exc
        if resp.status_code == 401:
            raise SourceError("A autorização do Trello não vale mais. Entre de novo com sua conta.", 401)
        if resp.status_code == 404:
            raise SourceError("Quadro não encontrado no Trello (ou sem acesso).", 404)
        if resp.status_code == 429:
            raise SourceError("O Trello limitou as requisições. Espere alguns segundos e tente de novo.", 429)
        if resp.status_code >= 400:
            raise SourceError(f"Trello respondeu {resp.status_code}: {resp.text[:200]}", 502)
        return resp.json()

    # --- Escrita (precisa de token com permissao de escrita) -----------------

    def _send(self, method, path, body=None, **params):
        """PUT/POST/DELETE no Trello. Os campos vao no corpo JSON (descricoes longas nao cabem na URL)."""
        if not self.configured():
            raise SourceError("Credenciais do Trello não configuradas no servidor.", 503)
        params.update(key=self.key, token=self.token)
        try:
            resp = self.http.request(method, f"{TRELLO_API}{path}", params=params, json=body, timeout=30)
        except requests.RequestException as exc:
            raise SourceError(f"Falha ao falar com o Trello ({type(exc).__name__}).") from exc
        if resp.status_code >= 400:
            raise write_error(resp.status_code, resp.text)
        return resp.json() if resp.content else None

    def card(self, card_id):
        """Card completo para o editor (sem cache: o editor mostra o estado atual)."""
        return self._get(f"/cards/{card_id}",
                         fields="name,desc,start,due,dueComplete,idList,idMembers,idLabels,shortUrl,idBoard,closed")

    def card_board(self, card_id):
        """Quadro de um card (a permissao de escrita e conferida pelo quadro)."""
        return self.cache.get_or_set(("card_board", card_id), 600, lambda: self._get(
            f"/cards/{card_id}", fields="idBoard,closed")["idBoard"])

    def labels(self, board_id):
        return self.cache.get_or_set(("labels", board_id), 300, lambda: self._get(
            f"/boards/{board_id}/labels", fields="name,color", limit=200))

    def memberships(self, board_id):
        return self.cache.get_or_set(("memberships", board_id), 300, lambda: self._get(
            f"/boards/{board_id}/memberships"))

    def my_id(self):
        return self.cache.get_or_set(("my_id",), 3600, lambda: self._get("/members/me", fields="id")["id"])

    def comments(self, card_id):
        return self._get(f"/cards/{card_id}/actions", filter="commentCard", limit=50,
                         memberCreator_fields="fullName,username,avatarUrl,initials")

    def action(self, action_id):
        return self._get(f"/actions/{action_id}", fields="idMemberCreator,type,data")

    def update_card(self, card_id, fields):
        return self._send("PUT", f"/cards/{card_id}", fields)

    def create_card(self, fields):
        return self._send("POST", "/cards", fields)

    def add_member(self, card_id, member_id):
        return self._send("POST", f"/cards/{card_id}/idMembers", {"value": member_id})

    def remove_member(self, card_id, member_id):
        return self._send("DELETE", f"/cards/{card_id}/idMembers/{member_id}")

    def add_label(self, card_id, label_id):
        return self._send("POST", f"/cards/{card_id}/idLabels", {"value": label_id})

    def remove_label(self, card_id, label_id):
        return self._send("DELETE", f"/cards/{card_id}/idLabels/{label_id}")

    def add_comment(self, card_id, text):
        return self._send("POST", f"/cards/{card_id}/actions/comments", {"text": text})

    def edit_comment(self, action_id, text):
        return self._send("PUT", f"/actions/{action_id}", {"text": text})

    def delete_comment(self, action_id):
        return self._send("DELETE", f"/actions/{action_id}")

    def forget_board(self, board_id):
        """Depois de uma escrita: a proxima leitura do quadro vem fresca do Trello."""
        self.cache.drop(lambda k: len(k) > 1 and k[1] == board_id and k[0] in ("cards", "actions"))

    def me(self):
        """Dados da conta dona do token (sem cache: usado no login)."""
        return self._get("/members/me", fields="fullName,username,avatarUrl,initials")

    def my_boards(self):
        return self.cache.get_or_set(("my_boards",), 120, lambda: self._get(
            "/members/me/boards", filter="open", fields="name,url,shortLink,closed",
            organization="true", organization_fields="displayName",
        ))

    def board(self, board_ref):
        return self._get(f"/boards/{board_ref}", fields="name,url,shortLink")

    def lists(self, board_id):
        return self.cache.get_or_set(("lists", board_id), 120, lambda: self._get(
            f"/boards/{board_id}/lists", filter="all", fields="name,closed,pos"))

    def members(self, board_id):
        return self.cache.get_or_set(("members", board_id), 300, lambda: self._get(
            f"/boards/{board_id}/members", fields="fullName,username,avatarUrl,initials"))

    def open_cards(self, board_id):
        return self.cache.get_or_set(("cards", board_id), 60, lambda: self._get(
            f"/boards/{board_id}/cards/open",
            fields="name,idList,idMembers,start,due,dueComplete,shortUrl,dateLastActivity"))

    def actions(self, board_id, since, before, ttl=60):
        """Acoes do quadro entre dois instantes UTC (ISO), paginando de 1000 em 1000."""
        def fetch():
            out, cursor = [], before
            while True:
                page = self._get(f"/boards/{board_id}/actions", filter=ACTION_FILTER,
                                 since=since, before=cursor, limit=PAGE,
                                 memberCreator_fields="fullName,username,avatarUrl,initials")
                out.extend(page)
                if len(page) < PAGE:
                    return out
                cursor = page[-1]["id"]
        return self.cache.get_or_set(("actions", board_id, since, before), ttl, fetch)


class PowerUpClient:
    def __init__(self, base_url, api_key, session=None):
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = api_key
        self.http = session or requests.Session()
        self.cache = TTLCache()

    def configured(self):
        return bool(self.base_url and self.api_key)

    def _send(self, method, path, body=None):
        """Leitura/escrita direta no Power-Up (editor de itens). Erros viram SourceError."""
        if not self.configured():
            raise SourceError("Power-Up de checklists não configurado no servidor.", 503)
        try:
            resp = self.http.request(method, f"{self.base_url}{path}", json=body,
                                     headers={"X-API-Key": self.api_key}, timeout=20)
        except requests.RequestException as exc:
            raise SourceError(f"Power-Up indisponível ({type(exc).__name__}).") from exc
        if resp.status_code >= 400:
            try:
                message = resp.json().get("erro")
            except ValueError:
                message = None
            if resp.status_code in (400, 409) and message:
                raise SourceError(message, resp.status_code)
            if resp.status_code == 404:
                raise SourceError(message or "Item não encontrado no Power-Up.", 404)
            if resp.status_code == 429:
                raise SourceError("O Power-Up limitou as requisições. Espere alguns segundos.", 429)
            raise SourceError(f"Power-Up respondeu {resp.status_code}.", 502)
        return resp.json() if resp.content else None

    def card_checklists(self, card_id):
        return self._send("GET", f"/cards/{card_id}/checklists").get("checklists", [])

    def create_checklist(self, card_id, board_id, nome):
        return self._send("POST", f"/cards/{card_id}/checklists", {"nome": nome, "boardId": board_id})

    def create_item(self, checklist_id, fields):
        return self._send("POST", f"/checklists/{checklist_id}/items", fields)

    def update_item(self, item_id, fields):
        return self._send("PATCH", f"/items/{item_id}", fields)

    def delete_item(self, item_id):
        return self._send("DELETE", f"/items/{item_id}")

    def forget_board(self, board_id):
        self.cache.drop(lambda k: len(k) > 1 and k[1] == board_id)

    def items(self, board_id):
        """Itens de checklist do Power-Up. Devolve (itens, aviso)."""
        if not self.configured():
            return [], "Power-Up de checklists não configurado."

        def fetch():
            try:
                resp = self.http.get(f"{self.base_url}/boards/{board_id}/items",
                                     headers={"X-API-Key": self.api_key}, timeout=20)
            except requests.RequestException as exc:
                return [], f"Power-Up indisponível ({type(exc).__name__})."
            if resp.status_code == 404:
                return [], "O Power-Up ainda não tem o endpoint de itens (atualize o trello-power)."
            if resp.status_code >= 400:
                return [], f"Power-Up respondeu {resp.status_code}."
            return resp.json().get("itens", []), None

        return self.cache.get_or_set(("items", board_id), 45, fetch)
