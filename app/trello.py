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
        if resp.status_code == 404:
            raise SourceError("Quadro não encontrado no Trello (ou sem acesso).", 404)
        if resp.status_code >= 400:
            raise SourceError(f"Trello respondeu {resp.status_code}: {resp.text[:200]}", 502)
        return resp.json()

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
