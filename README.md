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
- **Quadros**: cadastre pelo link ou escolha entre os quadros da conta do Trello, e marque quais
  listas contam como "concluído".

## Regras de cálculo

- **Card concluído no dia**: movido para uma lista marcada como concluída, ou com a data de
  entrega marcada como concluída. Conta para os membros do card (ou para quem moveu, se não houver membros).
- **Card pendente**: card aberto fora das listas de concluído e sem entrega concluída.
  Atrasado quando a data de entrega já passou. Usa o estado atual do card.
- **Item concluído no dia**: `concluidoEm` do Power-Up dentro do dia (fuso `TIMEZONE`).
  Conta para o responsável do item; sem responsável, para quem marcou.
- **Item pendente no dia**: criado até o fim do dia e não concluído até o fim do dia, em cards abertos.
  Atrasado quando a data de fim é anterior ao dia.
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
O SQLite (quadros cadastrados) fica no volume `produzia-data`. O Traefik publica em
`https://produzia.olimpo-services.com.br`.
