# Produzia

Painel de produtividade dos quadros do Trello: cadastre quadros e acompanhe, por pessoa e por dia,
itens de checklist (do Power-Up [trello-power](https://github.com/HermesSoftwareEngineer/trello-power)),
cards concluídos e pendentes, comentários e outras atividades.

```
React + Vite (frontend/) ──> API Flask (app/) ──┬──> API do Trello (key + token)
                                                └──> API do trello-power (X-API-Key)
```

## Páginas

- **Dashboard**: indicadores do período (7 a 90 dias) com comparação ao período anterior,
  atividade por dia, horário da atividade, tabela por pessoa e situação de cada quadro.
- **Resumo do dia**: escolha a data (setas ou ← → no teclado). Por pessoa: itens de checklist
  concluídos e pendentes, cards concluídos e pendentes, comentários, cards criados e movimentações.
- **Cronograma**: gráfico de Gantt de um quadro (listas, cards e itens de checklist), com zoom
  dia/semana/mês, linha de hoje, filtros e exportação em PDF.
- **Processos**: mapeamento de processos por quadro, com documento em Markdown (tabelas, listas de
  tarefas) e fluxograma em Mermaid (zoom, tela cheia, exportar SVG/PNG) ou em HTML/CSS livre,
  desenhado num iframe isolado que acompanha o tema. Crie e edite pela página ou por um agente de IA via MCP.
- **Calendário**: itens de checklist e cards com datas em vistas de mês, semana e dia, por prazo ou
  pelo dia da conclusão (só itens: o Trello não informa quando um card foi concluído). Filtros por
  pessoa, tipo e concluídas; ← → mudam o período.
- **Quadros**: cadastre pelo link ou escolha entre os quadros da conta do Trello, e marque quais
  listas contam como "concluído".

## Servidor MCP

O serviço `produzia-mcp` (pasta `mcp_server/`, SDK oficial `mcp` com FastMCP) expõe o Produzia
para agentes de IA via **Streamable HTTP** em `https://produzia.olimpo-services.com.br/mcp`.
Ele chama a API do Produzia pela rede docker (`PRODUZIA_API_URL=http://produzia:5000/api`)
com o header `X-API-Key: $PRODUZIA_API_KEY`.

### Autenticação

- **OAuth 2.0** (Claude no navegador, desktop e celular): o cliente descobre o servidor de
  autorização (`/.well-known/oauth-protected-resource/mcp` e `/.well-known/oauth-authorization-server`),
  registra-se sozinho (`/register`) e o dono autoriza em `/oauth/login` com o usuário e a senha do
  Produzia (`APP_USER`/`APP_PASSWORD`). Código com PKCE S256, access token de 24 h e refresh token de
  90 dias com rotação (sem endpoint de revogação: no SDK 1.27 ele exige `client_secret`, que
  clientes públicos não têm). Clientes e tokens (só o hash) ficam em SQLite no volume `produzia-mcp-data`.
- **Token fixo** `Authorization: Bearer $MCP_TOKEN`, para clientes configurados com header.

No claude.ai: **Configurações → Conectores → Adicionar conector personalizado**, URL
`https://produzia.olimpo-services.com.br/mcp` (sem client ID/secret). O desktop e o app usam o
mesmo conector da conta.

Conectar no Claude Code com o token fixo:

```bash
claude mcp add --transport http produzia https://produzia.olimpo-services.com.br/mcp   --header "Authorization: Bearer <MCP_TOKEN>"
```

Ferramentas:

| Ferramenta | O que faz |
|---|---|
| `listar_quadros` | Quadros cadastrados (id, nome, url) |
| `listar_processos(quadro_id?)` | Processos (sem o conteúdo), filtrando por quadro |
| `obter_processo(processo_id)` | Processo completo, com Markdown e Mermaid |
| `criar_processo(quadro_id, nome, descricao?, categoria?, markdown?, fluxograma_mermaid?)` | Cria; exige markdown ou fluxograma |
| `atualizar_processo(processo_id, nome?, descricao?, categoria?, quadro_id?, markdown?, fluxograma_mermaid?)` | Atualização parcial (`""` remove o campo) |
| `excluir_processo(processo_id)` | Exclui |
| `resumo_do_dia(data?, quadro_ids?)` | Resumo compacto do dia, por pessoa (leitura) |
| `dashboard(dias?, quadro_ids?)` | KPIs, quadros e ranking do período (leitura) |

O Markdown é GitHub-flavored (HTML bruto não é renderizado). O fluxograma é texto Mermaid sem
cercas, começando pelo tipo do diagrama (`flowchart TD`, `sequenceDiagram`, `stateDiagram-v2`…).

Rodar localmente: `pip install -r mcp_server/requirements.txt` e
`PRODUZIA_API_URL=http://127.0.0.1:5000/api PRODUZIA_API_KEY=... MCP_TOKEN=... python mcp_server/server.py`
(escuta em `:8000/mcp`).

### API de processos

`/api/processos` aceita a sessão do navegador ou `X-API-Key`. A mesma chave também lê
`GET /api/boards`, `GET /api/resumo` e `GET /api/dashboard`.

- `GET /api/processos?quadro=<id>` → `{processos: [...]}` (sem `markdown`/`fluxograma`)
- `GET /api/processos/<id>` → processo completo
- `POST /api/processos` com `{quadroId, nome, descricao?, categoria?, markdown?, fluxograma?}`
- `PATCH /api/processos/<id>` (ou `PUT`) com qualquer subconjunto dos campos
- `DELETE /api/processos/<id>`

Limites: nome 120 caracteres, descrição 500, categoria 60, markdown 200 KB, fluxograma 50 KB.
O campo `atualizadoPor` vale `web` (sessão) ou `mcp` (chave de serviço).

## Regras de cálculo

- **Card concluído no dia**: movido para uma lista marcada como concluída, ou com a data de
  entrega marcada como concluída. Conta para os membros do card (ou para quem moveu, se não houver membros).
- **Card pendente**: card aberto fora das listas de concluído e sem entrega concluída.
  Atrasado quando a data de entrega já passou. Usa o estado atual do card.
- **Itens contam pelo prazo** (data de fim do item; a de início, se for a única), não pelo dia em que
  alguém marcou o check. Vale para o Resumo do dia, o Dashboard e o Calendário.
- **Item concluído no dia D**: marcado como feito e com prazo em D. Conta para o responsável;
  sem responsável, para quem marcou. Só um item feito sem nenhuma data usa o dia em que foi marcado.
- **Item pendente no dia D**: em aberto, em card aberto, com prazo em D ("vence no dia") ou antes de D
  ("atrasado"). Itens em aberto sem prazo, ou com prazo depois de D, não entram no dia.
- **Comentários, cards criados e movimentações**: ações do Trello feitas pela pessoa no dia.

## Desenvolvimento

```bash
pip install -r requirements.txt pytest
cp .env.example .env          # preencha
flask --app wsgi run          # API em :5000 (use COOKIE_SECURE=0 no .env local)
cd frontend && npm install && npm run dev   # front em :5173, com proxy para /api
pytest
```

## Deploy (VPS olimpo)

```bash
ssh olimpo
cd /opt/produzia && git pull && docker compose up -d --build
```

Na primeira vez: `git clone` em `/opt/produzia`, `cp .env.example .env` e preencha.
Para o MCP, gere `PRODUZIA_API_KEY` e `MCP_TOKEN` (`openssl rand -hex 32` cada) no `.env`.
O SQLite (quadros cadastrados) fica no volume `produzia-data`. O Traefik publica em
`https://produzia.olimpo-services.com.br`.
