/* =========================================================
   admin.js — casca compartilhada das três telas de gestão:
   cabeçalho, tema, checagem de sessão, faixa de modo, cartões e
   dados de exemplo.
   ========================================================= */

window.Admin = (function () {
  const S = window.Stats;
  const C = window.Charts;

  /* ================= tema ================= */

  const LS_TEMA = 'pd:tema';

  function temaAtual() {
    const salvo = localStorage.getItem(LS_TEMA);
    if (salvo === 'dark' || salvo === 'light') return salvo;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function aplicarTema(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(LS_TEMA, t);
    window.dispatchEvent(new CustomEvent('pd:theme', { detail: t }));
  }

  function alternarTema() {
    aplicarTema(temaAtual() === 'dark' ? 'light' : 'dark');
    sincronizarBotaoTema();
  }

  function sincronizarBotaoTema() {
    const b = document.getElementById('btn-tema');
    if (!b) return;
    const escuro = temaAtual() === 'dark';
    b.textContent = escuro ? '☀' : '☾';
    b.setAttribute('aria-label', escuro ? 'Usar tema claro' : 'Usar tema escuro');
    b.title = b.getAttribute('aria-label');
  }

  /* ================= sessão =================
     O acesso é verificado no servidor: /api/eu responde 401 sem cookie
     de sessão válido, e as próprias páginas de gestão só são entregues
     a quem tem sessão. O que segue é a camada de conveniência — quem
     não tem sessão vai para o login em vez de ver uma tela quebrada. */

  let _eu = null;

  /** Dados da pessoa autenticada: {id, email, nome, papel, provisoria}. */
  function eu() { return _eu; }

  /**
   * Garante sessão válida para a tela atual.
   * @param {'respostas'|'usuarios'} exigencia
   * @returns {Promise<boolean>} false quando já redirecionou
   */
  async function exigirSessao(exigencia) {
    let dados = null;
    try {
      const res = await fetch('/api/eu', { headers: { accept: 'application/json' } });
      if (res.ok) dados = await res.json();
    } catch {
      // Sem rede não há como confirmar nada; manda para o login.
    }

    if (!dados) {
      location.href = '/login.html?de=' + encodeURIComponent(location.pathname);
      return false;
    }
    if (dados.usuario.provisoria) {
      location.href = '/login.html?trocar=1';
      return false;
    }
    const permitido = exigencia === 'usuarios'
      ? true                              // as duas contas abrem a tela de contas
      : dados.podeVerRespostas;
    if (!permitido) {
      location.href = dados.inicio || '/usuarios.html';
      return false;
    }

    _eu = dados.usuario;
    _eu.podeVerRespostas = dados.podeVerRespostas;
    _eu.podeAdministrarContas = dados.podeAdministrarContas;
    _eu.demoPermitida = !!dados.demoPermitida;
    _eu.temBanco = !!dados.temBanco;
    _eu.inicio = dados.inicio;
    return true;
  }

  async function sair() {
    try { await fetch('/api/logout', { method: 'POST' }); } catch {}
    location.href = '/login.html';
  }

  /* ================= cabeçalho ================= */

  /* As abas seguem o papel: TI administra contas e não vê as respostas,
     então só recebe a aba de Usuários. */
  function abasDoPapel() {
    const abas = [];
    if (_eu && _eu.podeVerRespostas) {
      abas.push({ href: 'dashboard.html', rotulo: 'Dashboard' });
      abas.push({ href: 'setores.html',   rotulo: 'Por setor' });
      abas.push({ href: 'respostas.html', rotulo: 'Respostas' });
    }
    abas.push({ href: 'usuarios.html', rotulo: 'Usuários' });
    return abas;
  }

  function cabecalho(ativa) {
    const abas = abasDoPapel().map((p) =>
      `<a href="${p.href}"${p.href === ativa ? ' aria-current="page"' : ''}>${p.rotulo}</a>`).join('');
    const casa = (_eu && _eu.inicio) || 'dashboard.html';
    const quem = _eu
      ? `<span class="topo-quem" title="${C.esc(_eu.email)}">
           <strong>${C.esc(_eu.email)}</strong>
           <small>${_eu.papel === 'ti' ? 'TI' : 'RH'}</small>
         </span>`
      : '';
    return `<header class="topo"><div class="topo-inner">
        <a class="marca" href="${C.esc(casa)}">
          <span class="marca-selo" aria-hidden="true">${C.esc((window.APP.EMPRESA || '?').trim()[0].toUpperCase())}</span>
          <span class="marca-txt">${C.esc(window.APP.EMPRESA)}<small>Pesquisa de Desligamento</small></span>
        </a>
        <nav class="abas" aria-label="Seções">${abas}</nav>
        <div class="topo-acoes">
          ${quem}
          <button class="icone-btn" id="btn-tema" type="button"></button>
          <button class="icone-btn" id="btn-sair" type="button" aria-label="Sair da área de gestão" title="Sair">⏻</button>
        </div>
      </div></header>`;
  }

  function montarCasca(ativa) {
    const alvo = document.getElementById('casca');
    if (alvo) alvo.outerHTML = cabecalho(ativa);
    sincronizarBotaoTema();
    document.getElementById('btn-tema')?.addEventListener('click', alternarTema);
    document.getElementById('btn-sair')?.addEventListener('click', sair);
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => sincronizarBotaoTema());
  }

  /* ================= faixa de modo de armazenamento ================= */

  /**
   * Faixa de aviso do topo. Cuida de dois casos que confundem:
   * • estar em modo local sem perceber
   * • ter respostas gravadas com setores que saíram da lista do formulário
   *   (é o que acontece depois de editar SETORES: os filtros por setor saem
   *   dos DADOS, não da configuração, então continuam mostrando os antigos)
   */
  function faixaModo(destino, temDados, registros) {
    if (!destino) return;
    destino.innerHTML = '';

    const local = window.Store.mode() !== 'api';
    const conhecidos = new Set(window.APP.SETORES);
    const fora = registros
      ? [...new Set(registros.map((r) => r.departamento))]
          .filter((s) => s && s !== 'Não informado' && !conhecidos.has(s))
      : [];

    let html = '';

    if (local) {
      html += `<div class="faixa-modo">
        <span aria-hidden="true">◆</span>
        <span><strong>Modo local.</strong> O servidor não respondeu em <code>/api/responses</code>,
        então os dados vêm do <code>localStorage</code> deste navegador — ninguém mais vê o que
        está aqui. Confira se o Postgres está conectado (a variável <code>DATABASE_URL</code>)
        para o armazenamento compartilhado entrar no
        ar.${temDados ? '' : ' Nenhuma resposta gravada ainda.'}</span>
        ${temDados ? '<button type="button" id="btn-limpar-local">Apagar dados deste navegador</button>' : ''}
      </div>`;
    }

    if (fora.length) {
      html += `<div class="faixa-modo">
        <span aria-hidden="true">◆</span>
        <span><strong>Setores fora da lista atual.</strong> Existem respostas gravadas em
        ${fora.length === 1 ? 'um setor que não está' : `${fora.length} setores que não estão`}
        mais no formulário: <em>${fora.map(C.esc).join(', ')}</em>. Os filtros por setor saem
        das respostas, não da configuração — por isso eles ainda aparecem aqui.
        ${local ? 'Apague os dados deste navegador e gere de novo para partir da lista nova.'
                : 'Respostas antigas continuam válidas; só o rótulo do setor é que saiu da lista.'}</span>
      </div>`;
    }

    destino.innerHTML = html;

    document.getElementById('btn-limpar-local')?.addEventListener('click', () => {
      const aviso = 'Apagar as respostas guardadas neste navegador?\n\n'
        + 'Isso vale só para este computador — não existe nada no servidor em modo local, '
        + 'então o que for apagado aqui não tem como voltar.';
      if (!confirm(aviso)) return;
      window.Store.clearLocal();
      location.reload();
    });
  }

  /* ================= estado vazio + dados de exemplo ================= */

  /* O botão de dados de exemplo só aparece quando gerar 160 respostas
     fictícias é inofensivo — ou seja, quando não há banco de produção
     atrás. Com Postgres ligado, ele sujaria a base real a dois cliques
     de distância; o servidor decide isso (PERMITIR_DEMO) e responde em
     /api/eu. */
  function vazioGeral(destino, aoCarregar) {
    const demo = !_eu || _eu.demoPermitida;

    destino.innerHTML = `<div class="vazio-geral">
        <h2>Nenhuma resposta ainda</h2>
        <p>${demo
          ? `Assim que as pessoas responderem a pesquisa, os indicadores aparecem aqui.
             Enquanto isso, você pode carregar um conjunto de exemplo para ver o painel
             funcionando de ponta a ponta — ele fica só neste navegador e pode ser
             apagado depois.`
          : `Assim que a primeira pessoa responder a pesquisa, os indicadores aparecem
             aqui. Compartilhe o link do formulário com quem está saindo.`}</p>
        <div class="acoes">
          ${demo ? '<button class="btn-acao forte" id="btn-demo" type="button">Carregar dados de exemplo</button>' : ''}
          <a class="btn-acao${demo ? '' : ' forte'}" href="pesquisa.html">Abrir a pesquisa</a>
        </div>
      </div>`;

    const b = document.getElementById('btn-demo');
    if (!b) return;
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Gerando…';
      const feito = await window.Demo.gerar(160);
      if (feito) { aoCarregar(); return; }
      b.disabled = false;
      b.textContent = 'Carregar dados de exemplo';
    });
  }

  /* ================= cartão com gêmeo em tabela ================= */

  let contador = 0;

  /**
   * opts: {
   *   pai, span:'c6', titulo, sub?, aria?,
   *   antes?: string        (HTML entre o cabeçalho e o gráfico: legenda, nota)
   *   desenhar(el)          monta o gráfico dentro de `el`
   *   tabela?: {cols, rows} gêmeo acessível
   *   rolarX?: boolean      gráfico largo rola no próprio contêiner
   *   acao?: string         HTML extra no canto do cabeçalho
   * }
   */
  function cartao(opts) {
    const id = 'k' + (++contador);
    const art = document.createElement('article');
    art.className = 'cartao ' + (opts.span || 'c6');

    const temTabela = !!(opts.tabela && opts.tabela.rows && opts.tabela.rows.length);
    const alternador = temTabela ? `<div class="alternador" role="group" aria-label="Formato de exibição">
        <button type="button" data-vista="grafico" aria-pressed="true" aria-controls="${id}-viz">Gráfico</button>
        <button type="button" data-vista="tabela" aria-pressed="false" aria-controls="${id}-tab">Tabela</button>
      </div>` : (opts.acao || '');

    art.innerHTML = `
      <div class="cartao-cabeca">
        <div>
          <h2>${C.esc(opts.titulo)}</h2>
          ${opts.sub ? `<p>${C.esc(opts.sub)}</p>` : ''}
        </div>
        ${alternador ? `<div class="direita">${alternador}</div>` : ''}
      </div>
      ${opts.antes || ''}
      <div class="viz-area${opts.rolarX ? ' rolar-x' : ''}" id="${id}-viz"></div>
      ${temTabela ? `<div id="${id}-tab" hidden>${C.tabela(opts.tabela.cols, opts.tabela.rows)}</div>` : ''}`;

    opts.pai.appendChild(art);
    if (opts.desenhar) opts.desenhar(art.querySelector('#' + id + '-viz'));

    if (temTabela) {
      const viz = art.querySelector('#' + id + '-viz');
      const tab = art.querySelector('#' + id + '-tab');
      const antes = art.querySelectorAll('.legenda, .legenda-escala, .nota-ref');
      art.querySelectorAll('.alternador button').forEach((b) => {
        b.addEventListener('click', () => {
          const grafico = b.dataset.vista === 'grafico';
          viz.hidden = !grafico;
          tab.hidden = grafico;
          antes.forEach((n) => { n.hidden = !grafico; });
          art.querySelectorAll('.alternador button').forEach((o) =>
            o.setAttribute('aria-pressed', String(o === b)));
          C.esconderTip();
        });
      });
    }
    return art;
  }

  /* ================= contagem do número principal =================
     Um só por tela (o herói). Se a pessoa pediu menos movimento no
     sistema, o número já aparece no valor final. */

  function contaAte(el, valor, formatar) {
    if (!el) return;
    const parado = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (parado || valor == null || !Number.isFinite(valor)) {
      el.textContent = formatar(valor);
      return;
    }
    const DUR = 900;
    const inicio = performance.now();
    (function passo(agora) {
      const p = Math.min(1, (agora - inicio) / DUR);
      const suave = 1 - Math.pow(1 - p, 3);        // desacelera na chegada
      el.textContent = formatar(valor * suave);
      if (p < 1) requestAnimationFrame(passo);
    })(inicio);
  }

  /* ================= pílula de perfil NPS ================= */

  function pilulaNps(nps) {
    const p = S.perfilNps(nps);
    if (!p) return '<span class="pilula st-neutro"><span class="st-ponto"></span>—</span>';
    const mapa = {
      promotor: ['good', 'Promotor'],
      neutro:   ['warning', 'Neutro'],
      detrator: ['critical', 'Detrator'],
    };
    const [st, rot] = mapa[p];
    return `<span class="pilula st-${st}"><span class="st-ponto"></span>${rot} ${nps}</span>`;
  }

  /* ================= cartão de número ================= */

  /** opts: {rot, valor, sufixo?, nota?, spark?: number[], medidor?: number} */
  function tile(opts) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.innerHTML = `
      <div class="tile-rot">${C.esc(opts.rot)}</div>
      <div class="tile-linha">
        <div class="tile-num">${C.esc(opts.valor)}${opts.sufixo ? `<small>${C.esc(opts.sufixo)}</small>` : ''}</div>
        ${opts.spark ? C.sparkline(opts.spark) : ''}
      </div>
      ${opts.medidor != null ? C.medidor(opts.medidor, opts.rot) : ''}
      ${opts.nota ? `<div class="tile-rot">${opts.nota}</div>` : ''}`;
    return el;
  }

  /* ================= navegação por clique em barra ================= */

  /** Barras com data-href viram links de verdade (delegação por contêiner). */
  function barrasClicaveis(container) {
    container.addEventListener('click', (e) => {
      const alvo = e.target.closest('[data-href]');
      if (alvo) location.href = alvo.getAttribute('data-href');
    });
    container.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const alvo = e.target.closest?.('[data-href]');
      if (alvo) { e.preventDefault(); location.href = alvo.getAttribute('data-href'); }
    });
  }

  /* ================= inicialização comum ================= */

  /**
   * Faz o caminho repetido das telas de resultado:
   * sessão → casca → carrega respostas → chama render(registros).
   */
  async function iniciar(ativa, render) {
    if (!await exigirSessao('respostas')) return;
    montarCasca(ativa);

    const conteudo = document.getElementById('conteudo');
    conteudo.innerHTML = '<p class="carregando">Carregando respostas…</p>';

    let registros = [];
    try { registros = await window.Store.list(); }
    catch { registros = []; }

    faixaModo(document.getElementById('faixa'), registros.length > 0, registros);
    render(registros, () => iniciar(ativa, render));
  }

  /** Versão sem carga de respostas, para a tela de contas. */
  async function iniciarSimples(ativa, render) {
    if (!await exigirSessao('usuarios')) return;
    montarCasca(ativa);
    render();
  }

  return {
    iniciar, iniciarSimples, exigirSessao, eu, montarCasca, faixaModo, vazioGeral,
    cartao, tile, pilulaNps, barrasClicaveis, contaAte,
    temaAtual, aplicarTema, alternarTema, sair,
  };
})();
