// Modelo inicial do fluxograma em HTML: etapas em cartoes, uma decisao e um desvio.
// As variaveis --pz-* vem do Produzia e mudam com o tema claro/escuro.
export const MODELO_FLUXO_HTML = `<style>
  .fx { display: flex; flex-direction: column; align-items: center; gap: 0; padding: 16px 8px 24px; }
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
  .fx-edge { width: 2px; height: 28px; background: var(--pz-line); position: relative; }
  .fx-edge::after {
    content: ''; position: absolute; bottom: -1px; left: 50%; transform: translateX(-50%);
    border: 6px solid transparent; border-top-color: var(--pz-line); border-bottom: 0;
  }
  .fx-pill {
    padding: 8px 18px; border-radius: 999px; font-weight: 600; font-size: 13px;
    background: color-mix(in srgb, var(--pz-brand) 14%, transparent); color: var(--pz-brand);
  }
  .fx-decision { position: relative; width: 132px; height: 132px; display: grid; place-items: center; margin: 4px 0; }
  .fx-decision::before {
    content: ''; position: absolute; inset: 18px; transform: rotate(45deg); border-radius: 14px;
    background: color-mix(in srgb, var(--pz-amber) 16%, var(--pz-surface)); border: 1px solid var(--pz-amber);
  }
  .fx-decision span { position: relative; font-weight: 600; font-size: 13px; text-align: center; width: 90px; }
  .fx-branches { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; width: min(560px, 100%); }
  .fx-branch { display: flex; flex-direction: column; align-items: center; }
  .fx-tag { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; margin-bottom: 6px; }
  .fx-yes { color: var(--pz-good); } .fx-no { color: var(--pz-bad); }
  .fx-branch .fx-step { width: 100%; }
  .fx-no-step { border-style: dashed; }
  .fx-loop { color: var(--pz-muted); font-size: 12px; margin-top: 6px; }
  @media (max-width: 520px) { .fx-branches { grid-template-columns: 1fr; } }
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

  <div class="fx-branches">
    <div class="fx-branch">
      <span class="fx-tag fx-yes">Sim</span>
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
      <span class="fx-tag fx-no">Não</span>
      <div class="fx-step fx-no-step">
        <span class="fx-n" style="background: var(--pz-bad)">!</span>
        <div><b>Pedir ajustes</b><small>Comenta no card o que falta</small></div>
      </div>
      <span class="fx-loop">↺ volta para a etapa 1</span>
    </div>
  </div>

  <div class="fx-edge"></div>
  <div class="fx-pill">Fim</div>
</div>
`
