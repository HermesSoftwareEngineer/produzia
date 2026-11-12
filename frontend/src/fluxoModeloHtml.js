// Modelo inicial do fluxograma em HTML: etapas em cartoes, uma decisao com bifurcacao
// (Sim / Nao) e a juncao de volta ao fluxo principal.
// As variaveis --pz-* vem do Produzia e mudam com o tema claro/escuro.
export const MODELO_FLUXO_HTML = `<style>
  .fx { --edge: color-mix(in srgb, var(--pz-muted) 55%, transparent); --gap: 24px;
    display: flex; flex-direction: column; align-items: center; padding: 16px 8px 24px; }
  .fx-step {
    display: flex; align-items: center; gap: 12px; width: min(420px, 100%);
    padding: 14px 16px; border-radius: 14px; background: var(--pz-surface);
    border: 1px solid var(--pz-line); box-shadow: 0 6px 20px rgb(15 23 42 / .06);
  }
  .fx-n {
    flex: none; width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center;
    font-weight: 700; font-size: 13px; color: #fff; background: var(--pz-brand);
  }
  .fx-step b { display: block; font-size: 14.5px; }
  .fx-step small { color: var(--pz-muted); font-size: 12.5px; }

  /* Seta vertical simples */
  .fx-edge { width: 2px; height: 30px; background: var(--edge); position: relative; }
  .fx-edge::after, .fx-arm::after {
    content: ''; position: absolute; bottom: -2px; left: 50%; transform: translateX(-50%);
    border: 6px solid transparent; border-top: 8px solid var(--edge); border-bottom: 0;
  }

  .fx-pill {
    padding: 8px 18px; border-radius: 999px; font-weight: 600; font-size: 13px;
    background: color-mix(in srgb, var(--pz-brand) 14%, transparent); color: var(--pz-brand);
  }
  .fx-decision { position: relative; width: 132px; height: 132px; display: grid; place-items: center; margin-top: 2px; }
  .fx-decision::before {
    content: ''; position: absolute; inset: 18px; transform: rotate(45deg); border-radius: 14px;
    background: color-mix(in srgb, var(--pz-amber) 16%, var(--pz-surface)); border: 1px solid var(--pz-amber);
  }
  .fx-decision span { position: relative; font-weight: 600; font-size: 13px; text-align: center; width: 90px; }

  /* Ramos lado a lado; os conectores apontam para o centro de cada coluna */
  .fx-split { width: min(600px, 100%); }
  .fx-branches { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap); }
  .fx-branch { display: flex; flex-direction: column; align-items: center; }
  .fx-branch .fx-step { width: 100%; }
  .fx-no-step { border-style: dashed; }
  .fx-loop { color: var(--pz-muted); font-size: 12px; margin-top: 8px; }

  .fx-fork, .fx-join { position: relative; height: 44px; }
  .fx-bar { position: absolute; height: 2px; background: var(--edge); }
  .fx-stub { position: absolute; left: 50%; width: 2px; height: 14px; margin-left: -1px; background: var(--edge); }
  .fx-arm { position: absolute; width: 2px; margin-left: -1px; background: var(--edge); }
  .fx-left { left: calc((100% - var(--gap)) / 4); }
  .fx-right { left: calc(100% - (100% - var(--gap)) / 4); }

  /* Bifurcacao: desce do losango, abre para os dois lados e desce em cada ramo */
  .fx-fork .fx-stub { top: 0; }
  .fx-fork .fx-bar { top: 14px; left: calc((100% - var(--gap)) / 4); right: calc((100% - var(--gap)) / 4); }
  .fx-fork .fx-arm { top: 14px; height: 30px; }
  .fx-label {
    position: absolute; top: 20px; font-size: 11px; font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase; transform: translateX(8px);
  }
  .fx-yes { color: var(--pz-good); } .fx-no { color: var(--pz-bad); }

  /* Juncao: o ramo Sim volta ao centro e segue para o fim */
  .fx-join .fx-arm.fx-up { top: 0; height: 16px; }
  .fx-join .fx-arm.fx-up::after { display: none; }
  .fx-join .fx-bar { top: 14px; left: calc((100% - var(--gap)) / 4); right: 50%; }
  .fx-join .fx-arm.fx-down { top: 14px; height: 30px; left: 50%; }

  @media (max-width: 520px) {
    .fx-branches { grid-template-columns: 1fr; }
    .fx-fork, .fx-join { display: none; }
    .fx-branch + .fx-branch { margin-top: 16px; }
  }
</style>

<div class="fx">
  <div class="fx-pill">Início</div>
  <div class="fx-edge"></div>

  <div class="fx-step">
    <span class="fx-n">1</span>
    <div><b>Receber a solicitação</b><small>Pedido chega pelo Trello</small></div>
  </div>
  <div class="fx-edge"></div>

  <div class="fx-decision"><span>Está completa?</span></div>

  <div class="fx-split">
    <div class="fx-fork">
      <span class="fx-stub"></span>
      <span class="fx-bar"></span>
      <span class="fx-arm fx-left"></span>
      <span class="fx-arm fx-right"></span>
      <span class="fx-label fx-yes fx-left">Sim</span>
      <span class="fx-label fx-no fx-right">Não</span>
    </div>

    <div class="fx-branches">
      <div class="fx-branch">
        <div class="fx-step">
          <span class="fx-n">2</span>
          <div><b>Executar a atividade</b><small>Responsável faz o checklist</small></div>
        </div>
        <div class="fx-edge"></div>
        <div class="fx-step">
          <span class="fx-n">3</span>
          <div><b>Revisar e registrar</b><small>Move o card para Concluído</small></div>
        </div>
      </div>
      <div class="fx-branch">
        <div class="fx-step fx-no-step">
          <span class="fx-n" style="background: var(--pz-bad)">!</span>
          <div><b>Pedir ajustes</b><small>Comenta no card o que falta</small></div>
        </div>
        <span class="fx-loop">↺ volta para a etapa 1</span>
      </div>
    </div>

    <div class="fx-join">
      <span class="fx-arm fx-up fx-left"></span>
      <span class="fx-bar"></span>
      <span class="fx-arm fx-down"></span>
    </div>
  </div>

  <div class="fx-pill">Fim</div>
</div>
`
