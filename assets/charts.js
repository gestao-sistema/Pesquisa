/* =========================================================
   charts.js — gráficos em SVG, sem bibliotecas.

   Regras aplicadas (método de dataviz):
   • marcas finas: barra ≤ 24px, linha 2px, marcador ≥ 8px
   • ponta de dado arredondada 4px, quadrada na linha de base
   • 2px de vão na cor da superfície entre marcas que se tocam
   • grade e eixos: hairline sólido, recessivo (nunca tracejado)
   • rótulos diretos seletivos — nunca um número em cada ponto
   • texto sempre em tokens de tinta, nunca na cor da série
   • um eixo por gráfico; nada de dois eixos y
   • toda carta tem gêmeo em tabela e camada de hover

   Uso:  Charts.barsH(el, spec)   → monta e re-renderiza no resize
   ========================================================= */

window.Charts = (function () {
  /* ---------------- infra ---------------- */

  const registro = new Map();   // elemento -> {fn, spec, jaDesenhou}

  function mount(el, fn, spec) {
    if (!el) return;
    registro.set(el, { fn, spec, jaDesenhou: false });
    desenhar(el);
  }

  function desenhar(el) {
    const item = registro.get(el);
    if (!item) return;
    const w = Math.max(240, el.clientWidth || el.parentElement?.clientWidth || 600);
    // Anima só na primeira montagem. Resize e troca de tema redesenham
    // sem movimento — repetir a entrada a cada arrasto da janela é ruído.
    const anima = !item.jaDesenhou;
    item.jaDesenhou = true;
    el.innerHTML = item.fn(w, item.spec, anima);
  }

  /* Atraso escalonado por linha, com teto: 20 barras não podem custar 2s
     de espera até a última aparecer. */
  function atraso(i, base) {
    return Math.min((i || 0) * 38, 420) + (base || 0);
  }

  /** Devolve o par class+delay de uma marca animada, ou nada se estiver desligado. */
  function an(ligado, classes, i, base) {
    if (!ligado) return '';
    return ` class="${classes}" style="animation-delay:${atraso(i, base)}ms"`;
  }

  let t = null;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => registro.forEach((_, el) => {
      if (el.isConnected) desenhar(el); else registro.delete(el);
    }), 140);
  });

  /* Re-desenha quando o tema muda (as cores vêm de custom properties,
     mas larguras de texto e degraus mudam de leitura). */
  window.addEventListener('pd:theme', () => registro.forEach((_, el) => desenhar(el)));

  /* ---------------- tooltip compartilhado ---------------- */

  let tip = null;
  function garantirTip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'viz-tip';
    tip.setAttribute('role', 'status');
    tip.hidden = true;
    document.body.appendChild(tip);
    return tip;
  }

  function mostrarTip(html, x, y) {
    const el = garantirTip();
    el.innerHTML = html;
    el.hidden = false;
    const r = el.getBoundingClientRect();
    let left = x + 14;
    let top = y - r.height - 12;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (left < 8) left = 8;
    if (top < 8) top = y + 18;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function esconderTip() { if (tip) tip.hidden = true; }

  /* Delegação global: qualquer marca com [data-tip] ganha tooltip,
     por hover e por foco de teclado (mesmo conteúdo). */
  document.addEventListener('mouseover', (e) => {
    const alvo = e.target.closest?.('[data-tip]');
    if (alvo) mostrarTip(alvo.getAttribute('data-tip'), e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', (e) => {
    const alvo = e.target.closest?.('[data-tip]');
    if (alvo && tip && !tip.hidden) mostrarTip(alvo.getAttribute('data-tip'), e.clientX, e.clientY);
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest?.('[data-tip]')) esconderTip();
  });
  document.addEventListener('focusin', (e) => {
    const alvo = e.target.closest?.('[data-tip]');
    if (!alvo) return;
    const r = alvo.getBoundingClientRect();
    mostrarTip(alvo.getAttribute('data-tip'), r.left + r.width / 2, r.top);
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.closest?.('[data-tip]')) esconderTip();
  });
  window.addEventListener('scroll', esconderTip, { passive: true });

  /* ---------------- utilidades ---------------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /** Corta texto por número aproximado de caracteres (o SVG não mede). */
  function cortar(s, max) {
    const txt = String(s == null ? '' : s);
    return txt.length <= max ? txt : txt.slice(0, Math.max(1, max - 1)) + '…';
  }

  /** Largura estimada de um texto — usada para decidir se um rótulo cabe. */
  function larguraTexto(s, px) {
    return String(s).length * px * 0.56;
  }

  /** Barra horizontal: ponta direita arredondada, base esquerda quadrada. */
  function pathBarraH(x, y, w, h, r) {
    if (w <= 0.5) return '';
    const rr = Math.min(r, w, h / 2);
    if (rr <= 0.5) return `M${x},${y} h${w} v${h} h${-w} Z`;
    return `M${x},${y} H${x + w - rr} a${rr},${rr} 0 0 1 ${rr},${rr} V${y + h - rr} a${rr},${rr} 0 0 1 ${-rr},${rr} H${x} Z`;
  }

  /** Espelho da anterior: ponta esquerda arredondada. */
  function pathBarraHEsq(x, y, w, h, r) {
    if (w <= 0.5) return '';
    const rr = Math.min(r, w, h / 2);
    if (rr <= 0.5) return `M${x},${y} h${w} v${h} h${-w} Z`;
    return `M${x + w},${y} H${x + rr} a${rr},${rr} 0 0 0 ${-rr},${rr} V${y + h - rr} a${rr},${rr} 0 0 0 ${rr},${rr} H${x + w} Z`;
  }

  /** Ticks "redondos" para o eixo de valor. */
  function ticks(max, alvo) {
    const passos = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    const bruto = max / (alvo || 4);
    const passo = passos.find((p) => p >= bruto) || Math.ceil(bruto / 1000) * 1000;
    const out = [];
    for (let v = 0; v <= max + 1e-9; v += passo) out.push(Number(v.toFixed(6)));
    return out;
  }

  function svgAbre(w, h, aria) {
    return `<svg class="viz" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" `
      + `role="img" aria-label="${esc(aria || '')}">`;
  }

  /* ---------------- 1. Barras horizontais (série única) ---------------- */
  /**
   * spec: {
   *   rows: [{label, value, tip, emphasis?, href?}],
   *   max?, formato?(v)->string, aria?,
   *   ref?: {value, label},          // linha de referência sólida
   *   escalaMax?: number             // limite do eixo (ex. 5 para Likert)
   * }
   */
  function barsH(w, spec, anima) {
    const rows = spec.rows || [];
    if (!rows.length) return vazio(w);

    const fonte = 12;
    const labelW = clamp(Math.round(w * 0.34), 92, 210);
    const valorW = spec.valorW || 54;
    const band = spec.band || 34;
    const grossura = Math.min(spec.grossura || 14, 24);
    const x0 = labelW + 12;
    const plotW = Math.max(48, w - x0 - valorW - 6);
    const h = rows.length * band + 10;

    const maxDados = Math.max(...rows.map((r) => Number(r.value) || 0));
    const max = spec.escalaMax || spec.max || (maxDados > 0 ? maxDados : 1);
    const sc = (v) => (clamp(Number(v) || 0, 0, max) / max) * plotW;
    const fmt = spec.formato || ((v) => String(v));

    let s = svgAbre(w, h, spec.aria);

    // linha de base (eixo de categoria)
    s += `<line x1="${x0}" y1="4" x2="${x0}" y2="${h - 6}" stroke="var(--axis)" stroke-width="1" />`;

    // linha de referência — sólida, recessiva, rotulada fora do plot
    if (spec.ref && spec.ref.value != null) {
      const xr = x0 + sc(spec.ref.value);
      s += `<line x1="${xr}" y1="2" x2="${xr}" y2="${h - 6}" stroke="var(--ink-muted)" stroke-width="1" />`;
    }

    rows.forEach((r, i) => {
      const yTopo = 6 + i * band;
      const yBarra = yTopo + (band - grossura) / 2 - 3;
      const val = Number(r.value);
      const temValor = Number.isFinite(val);
      const bw = temValor ? sc(val) : 0;
      const cor = r.emphasis === false ? 'var(--dim)' : 'var(--series-1)';

      // rótulo da categoria (tinta, nunca cor da série)
      s += `<text x="${labelW}" y="${yTopo + band / 2 - 3}" text-anchor="end" dominant-baseline="middle" `
        + `font-size="${fonte}" fill="var(--ink-2)">${esc(cortar(r.label, Math.floor(labelW / 6.6)))}</text>`;

      if (temValor && bw > 0.5) {
        s += `<path d="${pathBarraH(x0, yBarra, bw, grossura, 4)}" fill="${cor}" `
          + `pointer-events="none"${an(anima, 'an-barra an-esq', i)} />`;
      }

      // valor na ponta, sempre fora da barra (entra depois da barra chegar)
      s += `<text x="${x0 + bw + 8}" y="${yTopo + band / 2 - 3}" dominant-baseline="middle" `
        + `font-size="${fonte}" fill="var(--ink)" font-weight="600" `
        + `style="font-variant-numeric:tabular-nums${anima ? ';animation-delay:' + atraso(i, 200) + 'ms' : ''}" `
        + `pointer-events="none"${anima ? ' class="an-fade"' : ''}>`
        + `${esc(temValor ? fmt(val) : '—')}</text>`;

      // alvo de hover/foco: a faixa inteira (≥ 24px de altura)
      const tipHtml = r.tip || `<strong>${esc(r.label)}</strong><br>${esc(temValor ? fmt(val) : 'sem dados')}`;
      s += `<rect x="${x0}" y="${yTopo - 1}" width="${plotW + valorW}" height="${band}" fill="transparent" `
        + `data-tip="${esc(tipHtml)}" tabindex="0" ${r.href ? `data-href="${esc(r.href)}" class="viz-hit clicavel"` : 'class="viz-hit"'} />`;
    });

    return s + '</svg>';
  }

  /* ---------------- 2. Barras divergentes (delta contra uma base) ---------------- */
  /**
   * spec: { rows:[{label, value, tip}], max?, formato?(v), aria? }
   * value > 0 → polo positivo (azul, à direita); < 0 → polo negativo (vermelho)
   */
  function barsDiv(w, spec, anima) {
    const rows = spec.rows || [];
    if (!rows.length) return vazio(w);

    const fonte = 12;
    const labelW = clamp(Math.round(w * 0.30), 88, 200);
    // Reserva de cada lado: a barra pode encostar em qualquer um dos dois
    // extremos, e o valor fica sempre FORA da ponta. Sem esta folga o rótulo
    // de uma barra longa à esquerda invade a coluna de categorias.
    const bordaW = 56;
    const band = spec.band || 34;
    const grossura = Math.min(spec.grossura || 14, 24);
    const x0 = labelW + 12 + bordaW;
    // O domínio é simétrico (um −0,5 tem que parecer do mesmo tamanho que um
    // +0,5), então quando todos os valores têm o mesmo sinal um dos braços fica
    // vazio. Em tela larga isso viraria centenas de pixels de vão: o teto de
    // largura mantém a leitura sem esticar o gráfico à toa.
    const plotW = Math.min(Math.max(60, w - x0 - bordaW - 6), spec.plotMax || 900);
    const centro = x0 + plotW / 2;
    const h = rows.length * band + 10;

    const maxAbs = Math.max(...rows.map((r) => Math.abs(Number(r.value) || 0)), 0.01);
    const max = spec.max || maxAbs;
    const sc = (v) => (clamp(Math.abs(Number(v) || 0), 0, max) / max) * (plotW / 2);
    const fmt = spec.formato || ((v) => String(v));

    let s = svgAbre(w, h, spec.aria);

    // régua do zero — o "nada" do divergente
    s += `<line x1="${centro}" y1="2" x2="${centro}" y2="${h - 6}" stroke="var(--axis)" stroke-width="1" />`;

    rows.forEach((r, i) => {
      const yTopo = 6 + i * band;
      const yBarra = yTopo + (band - grossura) / 2 - 3;
      const val = Number(r.value);
      const temValor = Number.isFinite(val);
      const bw = temValor ? sc(val) : 0;
      const positivo = temValor && val >= 0;
      const cor = positivo ? 'var(--div-pos)' : 'var(--div-neg)';

      s += `<text x="${labelW}" y="${yTopo + band / 2 - 3}" text-anchor="end" dominant-baseline="middle" `
        + `font-size="${fonte}" fill="var(--ink-2)">${esc(cortar(r.label, Math.floor(labelW / 6.6)))}</text>`;

      if (temValor && bw > 0.5) {
        // Cresce a partir da régua do zero, para os dois lados.
        const mov = an(anima, 'an-barra ' + (positivo ? 'an-esq' : 'an-dir'), i);
        s += positivo
          ? `<path d="${pathBarraH(centro, yBarra, bw, grossura, 4)}" fill="${cor}" pointer-events="none"${mov} />`
          : `<path d="${pathBarraHEsq(centro - bw, yBarra, bw, grossura, 4)}" fill="${cor}" pointer-events="none"${mov} />`;
      }

      // valor sempre fora da ponta da barra
      const xv = positivo ? centro + bw + 8 : centro - bw - 8;
      s += `<text x="${xv}" y="${yTopo + band / 2 - 3}" dominant-baseline="middle" `
        + `text-anchor="${positivo ? 'start' : 'end'}" font-size="${fonte}" fill="var(--ink)" font-weight="600" `
        + `style="font-variant-numeric:tabular-nums${anima ? ';animation-delay:' + atraso(i, 200) + 'ms' : ''}" `
        + `pointer-events="none"${anima ? ' class="an-fade"' : ''}>`
        + `${esc(temValor ? fmt(val) : '—')}</text>`;

      const tipHtml = r.tip || `<strong>${esc(r.label)}</strong><br>${esc(temValor ? fmt(val) : 'sem dados')}`;
      s += `<rect x="${x0 - bordaW}" y="${yTopo - 1}" width="${plotW + bordaW * 2}" height="${band}" `
        + `fill="transparent" data-tip="${esc(tipHtml)}" tabindex="0" class="viz-hit" />`;
    });

    return s + '</svg>';
  }

  /* ---------------- 3. Barra empilhada divergente (Likert) ---------------- */
  /**
   * Forma canônica para escala ordenada (discordo ↔ concordo):
   * negativo à esquerda, neutro cavalgando o centro, positivo à direita.
   * spec: { rows:[{label, neg, neu, pos, n, tip?}], formato?(v), aria? }
   * neg/neu/pos em % (somam 100).
   */
  function likert(w, spec, anima) {
    const rows = (spec.rows || []).filter((r) => r.n > 0);
    if (!rows.length) return vazio(w);

    const fonte = 12;
    const labelW = clamp(Math.round(w * 0.30), 88, 200);
    const bordaW = 44;                       // espaço para os rótulos diretos
    const band = spec.band || 34;
    const grossura = Math.min(spec.grossura || 16, 24);
    const x0 = labelW + 12 + bordaW;
    const plotW = Math.max(80, w - x0 - bordaW - 6);
    const centro = x0 + plotW / 2;
    const h = rows.length * band + 10;
    const VAO = 2;                           // vão na cor da superfície

    const extremos = rows.map((r) => Math.max(r.neg + r.neu / 2, r.pos + r.neu / 2));
    const dominio = Math.max(...extremos, 10);
    const sc = (pct) => (pct / dominio) * (plotW / 2);
    const fmt = spec.formato || ((v) => Math.round(v) + '%');

    let s = svgAbre(w, h, spec.aria);
    s += `<line x1="${centro}" y1="2" x2="${centro}" y2="${h - 6}" stroke="var(--axis)" stroke-width="1" />`;

    rows.forEach((r, i) => {
      const yTopo = 6 + i * band;
      const y = yTopo + (band - grossura) / 2 - 3;

      const wNeg = sc(r.neg);
      const wNeu = sc(r.neu);
      const wPos = sc(r.pos);
      const xNeg = centro - sc(r.neg + r.neu / 2);
      const xNeu = xNeg + wNeg;
      const xPos = xNeu + wNeu;

      s += `<text x="${labelW}" y="${yTopo + band / 2 - 3}" text-anchor="end" dominant-baseline="middle" `
        + `font-size="${fonte}" fill="var(--ink-2)">${esc(cortar(r.label, Math.floor(labelW / 6.6)))}</text>`;

      // Os três segmentos crescem juntos, como uma barra só: animar cada um
      // com sua origem faria as fatias deslizarem umas sobre as outras.
      s += `<g${an(anima, 'an-barra an-centro', i)}>`;
      // negativo: ponta esquerda arredondada, direita encostada no vão
      if (wNeg > VAO) {
        s += `<path d="${pathBarraHEsq(xNeg, y, wNeg - VAO, grossura, 4)}" fill="var(--div-neg)" pointer-events="none" />`;
      }
      // neutro: quadrado nas duas pontas, recuado 2px de cada lado
      if (wNeu > VAO * 2) {
        s += `<rect x="${xNeu + VAO}" y="${y}" width="${wNeu - VAO * 2}" height="${grossura}" `
          + `fill="var(--div-mid)" pointer-events="none" />`;
      }
      // positivo: ponta direita arredondada
      if (wPos > VAO) {
        s += `<path d="${pathBarraH(xPos + VAO, y, wPos - VAO, grossura, 4)}" fill="var(--div-pos)" pointer-events="none" />`;
      }
      s += `</g>`;

      // rótulos diretos: só os dois polos, fora das pontas (o neutro fica no tooltip/tabela)
      const estiloRot = `font-variant-numeric:tabular-nums${anima ? ';animation-delay:' + atraso(i, 220) + 'ms' : ''}`;
      const classeRot = anima ? ' class="an-fade"' : '';
      s += `<text x="${xNeg - 7}" y="${yTopo + band / 2 - 3}" text-anchor="end" dominant-baseline="middle" `
        + `font-size="11" fill="var(--ink-2)" style="${estiloRot}" pointer-events="none"${classeRot}>`
        + `${esc(fmt(r.neg))}</text>`;
      s += `<text x="${xPos + wPos + 7}" y="${yTopo + band / 2 - 3}" dominant-baseline="middle" `
        + `font-size="11" fill="var(--ink)" font-weight="600" style="${estiloRot}" pointer-events="none"${classeRot}>`
        + `${esc(fmt(r.pos))}</text>`;

      const tipHtml = r.tip || `<strong>${esc(r.label)}</strong><br>`
        + `Negativo (1–2): ${fmt(r.neg)}<br>Neutro (3): ${fmt(r.neu)}<br>Positivo (4–5): ${fmt(r.pos)}<br>`
        + `<span class="tip-meta">${r.n} respostas</span>`;
      s += `<rect x="${x0 - bordaW}" y="${yTopo - 1}" width="${plotW + bordaW * 2}" height="${band}" `
        + `fill="transparent" data-tip="${esc(tipHtml)}" tabindex="0" class="viz-hit" />`;
    });

    return s + '</svg>';
  }

  /* ---------------- 4. Linha + área (série única no tempo) ---------------- */
  /**
   * spec: { points:[{label, labelLongo, value, tip?}], formato?(v), aria?, altura? }
   */
  function linha(w, spec, anima) {
    const pts = spec.points || [];
    if (pts.length < 2) return vazio(w, pts.length ? 'Um único período — sem tendência para mostrar.' : null);

    const fonte = 11;
    const padL = 34, padR = 16, padT = 12, faixaX = 24;
    const plotH = spec.altura || 168;
    const h = plotH + faixaX + padT;         // altura inclui a faixa do eixo x
    const plotW = Math.max(60, w - padL - padR);

    const maxV = Math.max(...pts.map((p) => Number(p.value) || 0), 1);
    const tks = ticks(maxV, 4);
    const topo = tks[tks.length - 1] || maxV;
    const y = (v) => padT + plotH - (clamp(Number(v) || 0, 0, topo) / topo) * plotH;
    const x = (i) => padL + (pts.length === 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
    const fmt = spec.formato || ((v) => String(v));

    let s = svgAbre(w, h, spec.aria);

    // grade: hairline sólido, recessivo
    tks.forEach((tk) => {
      s += `<line x1="${padL}" y1="${y(tk)}" x2="${padL + plotW}" y2="${y(tk)}" stroke="var(--grid)" stroke-width="1" />`;
      s += `<text x="${padL - 7}" y="${y(tk)}" text-anchor="end" dominant-baseline="middle" font-size="${fonte}" `
        + `fill="var(--ink-muted)" style="font-variant-numeric:tabular-nums">${esc(tk)}</text>`;
    });
    s += `<line x1="${padL}" y1="${y(0)}" x2="${padL + plotW}" y2="${y(0)}" stroke="var(--axis)" stroke-width="1" />`;

    // área: banho de ~10% da própria matiz, nunca bloco saturado
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
    s += `<path d="${d} L${x(pts.length - 1)},${y(0)} L${x(0)},${y(0)} Z" fill="var(--series-1)" fill-opacity="0.10"`
      + `${anima ? ' class="an-fade" style="animation-delay:320ms"' : ''} />`;
    // pathLength="1" normaliza o comprimento: o traço se desenha da esquerda
    // para a direita sem precisar medir o caminho.
    s += `<path d="${d}" fill="none" stroke="var(--series-1)" stroke-width="2" `
      + `stroke-linejoin="round" stroke-linecap="round"`
      + `${anima ? ' pathLength="1" stroke-dasharray="1" class="an-linha"' : ''} />`;

    // rótulos do eixo x — desafina para não colidir
    const passo = Math.max(1, Math.ceil(pts.length / Math.floor(plotW / 44)));
    pts.forEach((p, i) => {
      if (i % passo !== 0 && i !== pts.length - 1) return;
      s += `<text x="${x(i)}" y="${padT + plotH + 15}" text-anchor="middle" font-size="${fonte}" `
        + `fill="var(--ink-muted)">${esc(p.label)}</text>`;
    });

    // marcador só na ponta (≥ 8px) com anel de 2px na cor da superfície
    const ult = pts.length - 1;
    const chegada = anima ? ' class="an-fade" style="animation-delay:640ms"' : '';
    s += `<circle cx="${x(ult)}" cy="${y(pts[ult].value)}" r="5" fill="var(--series-1)" `
      + `stroke="var(--surface)" stroke-width="2" pointer-events="none"${chegada} />`;
    // rótulo direto apenas no último ponto
    s += `<text x="${x(ult) - 8}" y="${y(pts[ult].value) - 12}" text-anchor="end" font-size="12" `
      + `fill="var(--ink)" font-weight="600" style="font-variant-numeric:tabular-nums" `
      + `pointer-events="none"${chegada}>`
      + `${esc(fmt(pts[ult].value))}</text>`;

    // camada de acerto: uma fatia por período, com fio de prumo
    const fatia = plotW / pts.length;
    pts.forEach((p, i) => {
      const tipHtml = p.tip || `<strong>${esc(p.labelLongo || p.label)}</strong><br>${esc(fmt(p.value))}`;
      s += `<g class="viz-fatia">`
        + `<line x1="${x(i)}" y1="${padT}" x2="${x(i)}" y2="${padT + plotH}" stroke="var(--axis)" stroke-width="1" class="viz-prumo" />`
        + `<circle cx="${x(i)}" cy="${y(p.value)}" r="4" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2" class="viz-prumo" />`
        + `<rect x="${clamp(x(i) - fatia / 2, padL, padL + plotW)}" y="${padT}" width="${Math.min(fatia, plotW)}" height="${plotH}" `
        + `fill="transparent" data-tip="${esc(tipHtml)}" tabindex="0" />`
        + `</g>`;
    });

    return s + '</svg>';
  }

  /* ---------------- 5. Mapa de calor (magnitude, 1 matiz) ---------------- */
  /**
   * spec: {
   *   rows: [{label, href?}], cols: [{label}], cells: [[v|null]],
   *   dominio: [min, max], formato?(v), aria?
   * }
   */
  const DEGRAUS = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)', 'var(--seq-6)'];

  function degrauDe(v, dominio) {
    if (v == null || !Number.isFinite(v)) return -1;
    const [a, b] = dominio;
    const t = clamp((v - a) / (b - a || 1), 0, 0.9999);
    return Math.floor(t * DEGRAUS.length);
  }

  function heatmap(w, spec, anima) {
    const rows = spec.rows || [];
    const cols = spec.cols || [];
    if (!rows.length || !cols.length) return vazio(w);

    const fonte = 11;
    const labelW = clamp(Math.round(w * 0.24), 96, 190);
    const cabecaH = 92;                       // espaço dos rótulos inclinados
    const celaH = 30, VAO = 2;
    const x0 = labelW + 10;
    const plotW = Math.max(cols.length * 34, w - x0 - 10);
    const celaW = plotW / cols.length;
    const h = cabecaH + rows.length * celaH + 8;
    const fmt = spec.formato || ((v) => String(v));
    const dominio = spec.dominio || [1, 5];

    let s = svgAbre(Math.max(w, x0 + plotW + 10), h, spec.aria);

    // rótulos das colunas a -45° (legíveis sem virar a cabeça)
    cols.forEach((c, j) => {
      const cx = x0 + j * celaW + celaW / 2;
      s += `<text transform="translate(${cx},${cabecaH - 8}) rotate(-45)" text-anchor="start" `
        + `font-size="${fonte}" fill="var(--ink-2)">${esc(cortar(c.label, 18))}</text>`;
    });

    rows.forEach((r, i) => {
      const yTopo = cabecaH + i * celaH;
      s += `<text x="${labelW}" y="${yTopo + celaH / 2}" text-anchor="end" dominant-baseline="middle" `
        + `font-size="${fonte}" fill="var(--ink-2)">${esc(cortar(r.label, Math.floor(labelW / 6.2)))}</text>`;

      cols.forEach((c, j) => {
        const v = (spec.cells[i] || [])[j];
        const passo = degrauDe(v, dominio);
        const fill = passo < 0 ? 'var(--seq-0)' : DEGRAUS[passo];
        const cx = x0 + j * celaW;
        // texto dentro da célula: branco nos degraus escuros, tinta nos claros
        const claro = passo >= 0 && passo <= 2;
        const cabe = celaW - 8 > larguraTexto(fmt(v), 10);

        // Onda na diagonal: as células acendem do canto superior esquerdo
        // para o inferior direito, em vez de todas de uma vez.
        const onda = anima
          ? ` class="an-cela" style="animation-delay:${Math.min((i + j) * 22, 460)}ms"`
          : '';
        s += `<g${onda}>`;
        s += `<rect x="${cx + VAO / 2}" y="${yTopo + VAO / 2}" width="${Math.max(1, celaW - VAO)}" `
          + `height="${celaH - VAO}" rx="3" fill="${fill}" pointer-events="none" />`;

        if (passo >= 0 && cabe) {
          s += `<text x="${cx + celaW / 2}" y="${yTopo + celaH / 2}" text-anchor="middle" dominant-baseline="middle" `
            + `font-size="10" fill="${claro ? '#0b0b0b' : '#ffffff'}" style="font-variant-numeric:tabular-nums" `
            + `pointer-events="none">${esc(fmt(v))}</text>`;
        }
        s += `</g>`;

        const tipHtml = `<strong>${esc(r.label)}</strong><br>${esc(c.label)}<br>`
          + (passo >= 0 ? esc(fmt(v)) : '<span class="tip-meta">sem respostas</span>');
        s += `<rect x="${cx}" y="${yTopo}" width="${celaW}" height="${celaH}" fill="transparent" `
          + `data-tip="${esc(tipHtml)}" tabindex="0" class="viz-hit" />`;
      });
    });

    return s + '</svg>';
  }

  /* ---------------- 6. Sparkline (para os cartões de número) ---------------- */
  function sparkline(valores, w, h) {
    const vals = (valores || []).filter((v) => Number.isFinite(v));
    if (vals.length < 2) return '';
    const W = w || 96, H = h || 26;
    const max = Math.max(...vals), min = Math.min(...vals);
    const span = max - min || 1;
    const x = (i) => (i / (vals.length - 1)) * (W - 6) + 3;
    const y = (v) => H - 3 - ((v - min) / span) * (H - 8);
    const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">`
      + `<path d="${d}" fill="none" stroke="var(--dim)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`
      + `<circle cx="${x(vals.length - 1).toFixed(1)}" cy="${y(vals[vals.length - 1]).toFixed(1)}" r="3" `
      + `fill="var(--series-1)" stroke="var(--surface)" stroke-width="2" />`
      + `</svg>`;
  }

  /* ---------------- 7. Medidor (uma razão contra um limite) ---------------- */
  function medidor(pct, rotulo) {
    const p = clamp(Number(pct) || 0, 0, 100);
    return `<div class="medidor" role="img" aria-label="${esc(rotulo || '')} ${p.toFixed(0)}%">`
      + `<div class="medidor-trilha"><div class="medidor-fill" style="width:${p}%"></div></div></div>`;
  }

  /* ---------------- 8. Barra NPS (divergente, 3 grupos) ---------------- */
  function barraNps(res) {
    if (!res || !res.n) return '<p class="vazio-inline">Sem respostas de recomendação.</p>';
    const seg = (cls, pct, rot, qtd) => pct <= 0 ? '' :
      `<div class="nps-seg ${cls}" style="flex:${pct}" tabindex="0"
        data-tip="<strong>${esc(rot)}</strong><br>${qtd} de ${res.n} (${pct.toFixed(0).replace('.', ',')}%)"></div>`;
    return `<div class="nps-barra">`
      + seg('neg', res.pctDetratores, 'Detratores (0–6)', res.detratores)
      + seg('mid', res.pctNeutros, 'Neutros (7–8)', res.neutros)
      + seg('pos', res.pctPromotores, 'Promotores (9–10)', res.promotores)
      + `</div>`;
  }

  /* ---------------- Legenda (HTML, não SVG) ---------------- */
  /** itens: [{cor: 'var(--div-neg)', label, forma?: 'quadrado'|'linha'}] */
  function legenda(itens) {
    if (!itens || itens.length < 2) return '';
    return `<ul class="legenda">` + itens.map((i) =>
      `<li><span class="chave ${i.forma === 'linha' ? 'chave-linha' : ''}" style="--c:${i.cor}"></span>`
      + `<span>${esc(i.label)}</span></li>`).join('') + `</ul>`;
  }

  /** Legenda de escala para o mapa de calor (rampa sequencial). */
  function legendaEscala(dominio, rotulo) {
    const passos = DEGRAUS.map((c) => `<span class="degrau" style="background:${c}"></span>`).join('');
    return `<div class="legenda-escala"><span class="le-rot">${esc(rotulo || '')}</span>`
      + `<span class="le-min">${esc(dominio[0].toString().replace('.', ','))}</span>`
      + `<span class="le-rampa">${passos}</span>`
      + `<span class="le-max">${esc(dominio[1].toString().replace('.', ','))}</span></div>`;
  }

  /* ---------------- Gêmeo em tabela ---------------- */
  /** cols: [{titulo, num?}] · rows: [[celula,...]] */
  function tabela(cols, rows) {
    if (!rows || !rows.length) return '<p class="vazio-inline">Sem dados.</p>';
    const th = cols.map((c) => `<th scope="col" class="${c.num ? 'num' : ''}">${esc(c.titulo)}</th>`).join('');
    const tb = rows.map((r) =>
      '<tr>' + r.map((c, i) => {
        const num = cols[i] && cols[i].num;
        return i === 0
          ? `<th scope="row">${esc(c)}</th>`
          : `<td class="${num ? 'num' : ''}">${esc(c)}</td>`;
      }).join('') + '</tr>').join('');
    return `<div class="tabela-wrap"><table class="tabela-viz"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
  }

  /* ---------------- Estado vazio ---------------- */
  function vazio(w, msg) {
    return `<div class="vazio-inline">${esc(msg || 'Sem dados suficientes para este gráfico.')}</div>`;
  }

  /* ---------------- API ---------------- */
  return {
    barsH:    (el, spec) => mount(el, barsH, spec),
    barsDiv:  (el, spec) => mount(el, barsDiv, spec),
    likert:   (el, spec) => mount(el, likert, spec),
    linha:    (el, spec) => mount(el, linha, spec),
    heatmap:  (el, spec) => mount(el, heatmap, spec),
    sparkline, medidor, barraNps, legenda, legendaEscala, tabela,
    esc, esconderTip,
  };
})();
