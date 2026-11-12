"""Servidor MCP do Produzia (Streamable HTTP em /mcp).

Fala com a API REST do Produzia usando a chave de servico (X-API-Key). Os clientes MCP
se autenticam por OAuth 2.0 (ver oauth.py) ou pelo token fixo "Authorization: Bearer <MCP_TOKEN>".
"""
import json
import os
from typing import Annotated, Any

import httpx
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from pydantic import AnyHttpUrl, Field
from starlette.responses import JSONResponse

try:
    from .oauth import SCOPE, ProduziaOAuthProvider
except ImportError:  # executado como script dentro do container
    from oauth import SCOPE, ProduziaOAuthProvider

INSTRUCOES = """\
Produzia é o painel de produtividade dos quadros do Trello da equipe. Aqui você consulta os
quadros cadastrados, o resumo do dia e o dashboard, e mantém o Mapeamento de Processos:
cada processo pertence a um quadro e tem um documento em Markdown (GitHub-flavored: títulos,
listas, tabelas, listas de tarefas "- [ ]") e/ou um fluxograma. O fluxograma pode ser Mermaid
(ex.: "flowchart TD") ou HTML livre com CSS, quando o visual importa: o HTML é desenhado numa
área isolada, então capriche no layout (cores, cartões das etapas, setas, losangos de decisão).
Use listar_quadros para descobrir o quadro_id antes de criar processos.
Antes de atualizar, leia o processo com obter_processo para não perder conteúdo."""

DOC_MARKDOWN = (
    "Documento do processo em Markdown GitHub-flavored (títulos #, listas, tabelas, "
    "listas de tarefas '- [ ]', blocos de código). HTML bruto não é renderizado. Até 200 KB."
)
DOC_MERMAID = (
    "Fluxograma em sintaxe Mermaid, SEM cercas ```mermaid. A primeira linha declara o tipo, "
    "de preferência 'flowchart TD' (ou LR). Exemplo:\n"
    "flowchart TD\n  A[Pedido recebido] --> B{Pagamento aprovado?}\n"
    "  B -->|Sim| C[Separar estoque]\n  B -->|Não| D[Avisar cliente]\n"
    "Coloque textos com acentos, parênteses ou dois-pontos entre aspas: A[\"Etapa (1): revisão\"]. "
    "Também aceita sequenceDiagram, stateDiagram-v2 etc. Até 50 KB. "
    "Use fluxograma_mermaid OU fluxograma_html, não os dois."
)
DOC_HTML = (
    "Fluxograma em HTML livre com CSS (e JS opcional), para quando o visual é prioridade. Pode ser um "
    "fragmento (<style>...</style><div>...</div>) ou um documento completo. É exibido num iframe isolado "
    "(sem acesso ao Produzia), com fonte Inter e fundo transparente; a altura se ajusta ao conteúdo. "
    "O atributo data-theme='light'|'dark' do <html> acompanha o tema do app, então você pode estilizar "
    "os dois com [data-theme=dark]. Prefira um layout responsivo (flex/grid, largura 100%). Até 300 KB. "
    "Use fluxograma_mermaid OU fluxograma_html, não os dois."
)


def _fluxo(mermaid, html):
    """Escolhe o campo de fluxograma enviado e o tipo correspondente."""
    if mermaid is not None and html is not None:
        raise ToolError("Envie fluxograma_mermaid ou fluxograma_html, não os dois.")
    if html is not None:
        return {"fluxograma": html, "fluxogramaTipo": "html"}
    if mermaid is not None:
        return {"fluxograma": mermaid, "fluxogramaTipo": "mermaid"}
    return {}


class ProduziaAPI:
    """Cliente minimo da API REST do Produzia."""

    def __init__(self, base_url, api_key, transport=None):
        self.client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"), headers={"X-API-Key": api_key},
            timeout=httpx.Timeout(120, connect=10), transport=transport,
        )

    async def request(self, method, path, params=None, body=None):
        try:
            resp = await self.client.request(method, path, params=params, json=body)
        except httpx.HTTPError as exc:
            raise ToolError(f"Não consegui falar com o Produzia ({type(exc).__name__}).") from exc
        if resp.status_code == 204:
            return None
        try:
            data = resp.json()
        except ValueError:
            data = {}
        if resp.status_code >= 400:
            message = data.get("erro") if isinstance(data, dict) else None
            raise ToolError(message or f"O Produzia respondeu {resp.status_code}.")
        return data


def _quadros_param(quadro_ids):
    return {"quadros": ",".join(quadro_ids)} if quadro_ids else {}


def _card(c):
    card = c.get("card") or {}
    return card.get("nome") or ""


def compact_resumo(data, limite=10):
    pessoas = []
    for p in data.get("pessoas", []):
        t = p["totais"]
        if not p.get("atividade") and not t["itensPendentes"] and not t["cardsPendentes"]:
            continue
        atrasados = [i for i in p["itensPendentes"] if i.get("status") == "atrasado"]
        pessoas.append({
            "nome": p["pessoa"]["nome"],
            "totais": t,
            "itensConcluidos": [f"{i['texto']} ({_card(i)})" for i in p["itensConcluidos"][:limite]],
            "cardsConcluidos": [_card(c) for c in p["cardsConcluidos"][:limite]],
            "itensAtrasados": [
                f"{i['texto']} ({_card(i)}, prazo {i.get('dataFim') or '?'})" for i in atrasados[:limite]
            ],
            "comentarios": [f"{_card(c)}: {c['texto'][:160]}" for c in p["comentarios"][:limite]],
        })
    return {"data": data.get("data"), "totais": data.get("totais"), "pessoas": pessoas,
            "avisos": data.get("avisos", [])}


def compact_dashboard(data, limite=15):
    keys = ("cardsConcluidos", "itensConcluidos", "comentarios", "cardsCriados",
            "itensPendentes", "itensAtrasados", "cardsPendentes", "cardsAtrasados")
    return {
        "inicio": data.get("inicio"), "fim": data.get("fim"), "dias": data.get("dias"),
        "kpis": data.get("kpis"),
        "quadros": [
            {k: b[k] for k in ("id", "nome", "cardsAbertos", "cardsAtrasados", "cardsConcluidos",
                                 "comentarios", "itensFeitos", "itensTotal", "itensAtrasados")}
            for b in data.get("quadros", [])
        ],
        "ranking": [{"nome": r["pessoa"]["nome"], **{k: r[k] for k in keys}}
                    for r in data.get("ranking", [])[:limite]],
        "avisos": data.get("avisos", []),
    }


def build_server(api: ProduziaAPI, **settings) -> FastMCP:
    mcp = FastMCP("produzia", instructions=INSTRUCOES, **settings)

    @mcp.tool(description="Lista os quadros do Trello cadastrados no Produzia (id e nome). "
                          "Use o id como quadro_id nas outras ferramentas.")
    async def listar_quadros() -> dict:
        data = await api.request("GET", "/boards")
        return {"quadros": [{"id": b["id"], "nome": b["nome"], "url": b["url"]} for b in data["quadros"]]}

    @mcp.tool(description="Lista os processos mapeados (sem o conteúdo), agrupáveis por categoria. "
                          "Informe quadro_id para filtrar por quadro. Use obter_processo para ler o conteúdo.")
    async def listar_processos(
        quadro_id: Annotated[str | None, Field(description="ID do quadro (de listar_quadros). Vazio = todos.")] = None,
    ) -> dict:
        params = {"quadro": quadro_id} if quadro_id else None
        return await api.request("GET", "/processos", params=params)

    @mcp.tool(description="Retorna um processo completo: nome, descrição, categoria, quadro, "
                          "documento Markdown e fluxograma (fluxogramaTipo diz se é mermaid ou html).")
    async def obter_processo(
        processo_id: Annotated[str, Field(description="ID do processo (de listar_processos).")],
    ) -> dict:
        return await api.request("GET", f"/processos/{processo_id}")

    @mcp.tool(description="Cria um processo num quadro. Informe pelo menos um entre markdown "
                          "(documento GitHub-flavored) e um fluxograma: fluxograma_mermaid (ex.: 'flowchart TD') "
                          "ou fluxograma_html (HTML/CSS livre, para um visual caprichado). "
                          "Retorna o processo criado com o id.")
    async def criar_processo(
        quadro_id: Annotated[str, Field(description="ID do quadro (de listar_quadros).")],
        nome: Annotated[str, Field(description="Nome curto do processo (até 120 caracteres).", max_length=120)],
        descricao: Annotated[str | None, Field(description="Resumo de uma ou duas frases (até 500 caracteres).")] = None,
        categoria: Annotated[str | None, Field(description="Agrupamento opcional, ex.: 'Comercial', 'Financeiro'.")] = None,
        markdown: Annotated[str | None, Field(description=DOC_MARKDOWN)] = None,
        fluxograma_mermaid: Annotated[str | None, Field(description=DOC_MERMAID)] = None,
        fluxograma_html: Annotated[str | None, Field(description=DOC_HTML)] = None,
    ) -> dict:
        fluxo = _fluxo(fluxograma_mermaid, fluxograma_html)
        if not (markdown or "").strip() and not (fluxo.get("fluxograma") or "").strip():
            raise ToolError("Informe pelo menos um: markdown ou um fluxograma (fluxograma_mermaid ou fluxograma_html).")
        body = {"quadroId": quadro_id, "nome": nome, "descricao": descricao or "",
                "categoria": categoria, "markdown": markdown, **fluxo}
        return await api.request("POST", "/processos", body=body)

    @mcp.tool(description="Atualiza um processo. Só os campos informados mudam; os demais ficam como estão. "
                          "Envie string vazia em categoria, markdown ou no fluxograma para remover o campo "
                          "(o processo precisa manter documento ou fluxograma). Os textos enviados substituem "
                          "os atuais por inteiro: leia antes com obter_processo.")
    async def atualizar_processo(
        processo_id: Annotated[str, Field(description="ID do processo.")],
        nome: Annotated[str | None, Field(description="Novo nome (até 120 caracteres).", max_length=120)] = None,
        descricao: Annotated[str | None, Field(description="Novo resumo.")] = None,
        categoria: Annotated[str | None, Field(description="Nova categoria ('' remove).")] = None,
        quadro_id: Annotated[str | None, Field(description="Mover para outro quadro cadastrado.")] = None,
        markdown: Annotated[str | None, Field(description=DOC_MARKDOWN)] = None,
        fluxograma_mermaid: Annotated[str | None, Field(description=DOC_MERMAID)] = None,
        fluxograma_html: Annotated[str | None, Field(description=DOC_HTML)] = None,
    ) -> dict:
        fields = {"nome": nome, "descricao": descricao, "categoria": categoria, "quadroId": quadro_id,
                  "markdown": markdown}
        body = {k: v for k, v in fields.items() if v is not None}
        body.update(_fluxo(fluxograma_mermaid, fluxograma_html))
        if not body:
            raise ToolError("Informe pelo menos um campo para atualizar.")
        return await api.request("PATCH", f"/processos/{processo_id}", body=body)

    @mcp.tool(description="Exclui um processo definitivamente. Confirme com o usuário antes.")
    async def excluir_processo(
        processo_id: Annotated[str, Field(description="ID do processo.")],
    ) -> dict:
        await api.request("DELETE", f"/processos/{processo_id}")
        return {"ok": True, "excluido": processo_id}

    @mcp.tool(description="Resumo compacto de um dia (somente leitura): por pessoa, itens de checklist e "
                          "cards concluídos, itens atrasados, comentários e totais. Data no fuso do Produzia.")
    async def resumo_do_dia(
        data: Annotated[str | None, Field(description="Dia no formato AAAA-MM-DD. Vazio = hoje.")] = None,
        quadro_ids: Annotated[list[str] | None, Field(description="Filtrar por IDs de quadros. Vazio = todos.")] = None,
    ) -> dict:
        params = {**_quadros_param(quadro_ids), **({"data": data} if data else {})}
        return compact_resumo(await api.request("GET", "/resumo", params=params))

    @mcp.tool(description="Indicadores do período (somente leitura): KPIs com comparação ao período anterior, "
                          "situação por quadro e ranking por pessoa.")
    async def dashboard(
        dias: Annotated[int, Field(description="Tamanho do período em dias (1 a 90).", ge=1, le=90)] = 14,
        quadro_ids: Annotated[list[str] | None, Field(description="Filtrar por IDs de quadros. Vazio = todos.")] = None,
    ) -> dict:
        params = {"dias": dias, **_quadros_param(quadro_ids)}
        return compact_dashboard(await api.request("GET", "/dashboard", params=params))

    return mcp


def create_app(env: dict[str, Any] | None = None, transport=None):
    env = env if env is not None else os.environ
    api = ProduziaAPI(env.get("PRODUZIA_API_URL", "http://produzia:5000/api"),
                      env.get("PRODUZIA_API_KEY", ""), transport=transport)
    public_url = env.get("PUBLIC_URL", "https://produzia.olimpo-services.com.br").rstrip("/")
    provider = ProduziaOAuthProvider(
        public_url=public_url,
        db_path=env.get("OAUTH_DB_PATH", "/data/oauth.sqlite3"),
        user=env.get("APP_USER", "admin"),
        password=env.get("APP_PASSWORD", ""),
        static_token=env.get("MCP_TOKEN", ""),
    )
    # OAuth 2.0 (claude.ai, desktop, celular): descoberta RFC 9728/8414, registro dinamico
    # RFC 7591, PKCE. O token fixo MCP_TOKEN continua valendo para clientes com header.
    auth = AuthSettings(
        issuer_url=AnyHttpUrl(public_url),
        resource_server_url=AnyHttpUrl(f"{public_url}/mcp"),
        client_registration_options=ClientRegistrationOptions(
            enabled=True, valid_scopes=[SCOPE], default_scopes=[SCOPE]),
        # Revogacao desligada: no SDK 1.27 o /revoke exige client_secret, que clientes publicos
        # (como o claude.ai, com PKCE) nao tem. Tokens expiram sozinhos (24 h / 90 dias).
        revocation_options=RevocationOptions(enabled=False),
        required_scopes=[SCOPE],
    )
    # host 0.0.0.0: atras do Traefik o Host e o dominio publico.
    # Stateless: cada POST e independente (sobrevive a restart do container sem sessao perdida).
    # Respostas em SSE: json_response=True devolve corpo vazio no uvicorn com mcp 1.27/starlette 1.0.
    mcp = build_server(api, host="0.0.0.0", stateless_http=True, streamable_http_path="/mcp",
                       auth_server_provider=provider, auth=auth)

    @mcp.custom_route("/health", methods=["GET"])
    async def health(_request):
        return JSONResponse({"status": "ok"})

    @mcp.custom_route("/oauth/login", methods=["GET"])
    async def login_page(request):
        return await provider.login_page(request)

    @mcp.custom_route("/oauth/login", methods=["POST"])
    async def login_submit(request):
        return await provider.login_submit(request)

    return mcp.streamable_http_app()


def main():
    import uvicorn

    if not os.environ.get("APP_PASSWORD"):
        raise SystemExit("Defina APP_PASSWORD (login da autorizacao OAuth).")
    uvicorn.run(create_app(), host="0.0.0.0", port=int(os.environ.get("PORT", "8000")),
                proxy_headers=True, forwarded_allow_ips="*")


if __name__ == "__main__":
    main()
