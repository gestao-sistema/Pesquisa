/* =========================================================
   stats.js — agregações. Só cálculo, nada de DOM.
   ========================================================= */

window.Stats = (function () {
  const DIMS = window.APP.DIMENSOES;
  const DIM_IDS = DIMS.map((d) => d.id);

  /* ---------------- helpers ---------------- */

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  function media(valores) {
    const v = valores.filter((x) => num(x) !== null);
    if (!v.length) return null;
    return v.reduce((a, b) => a + b, 0) / v.length;
  }

  function fmt1(v) { return v == null ? '—' : v.toFixed(1).replace('.', ','); }
  function fmt2(v) { return v == null ? '—' : v.toFixed(2).replace('.', ','); }
  function fmtInt(v) { return v == null ? '—' : new Intl.NumberFormat('pt-BR').format(Math.round(v)); }
  function fmtPct(v, dec) {
    if (v == null) return '—';
    return v.toFixed(dec == null ? 0 : dec).replace('.', ',') + '%';
  }
  function fmtSigned(v, dec) {
    if (v == null) return '—';
    const d = dec == null ? 2 : dec;
    const s = Math.abs(v).toFixed(d).replace('.', ',');
    if (Math.abs(v) < Math.pow(10, -d) / 2) return '0,' + '0'.repeat(d);
    return (v > 0 ? '+' : '−') + s;
  }
  /** eNPS como pontuação assinada, com o sinal de menos tipográfico (−, não -). */
  function fmtNps(v) {
    if (v == null) return '—';
    const n = Math.round(v);
    if (n > 0) return '+' + n;
    if (n < 0) return '−' + Math.abs(n);
    return '0';
  }
  function fmtData(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function fmtDataHora(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  /* ---------------- NPS ---------------- */

  function perfilNps(n) {
    if (num(n) === null) return null;
    if (n >= 9) return 'promotor';
    if (n >= 7) return 'neutro';
    return 'detrator';
  }

  function nps(records) {
    const vals = records.map((r) => r.nps).filter((v) => num(v) !== null);
    const n = vals.length;
    if (!n) return { n: 0, promotores: 0, neutros: 0, detratores: 0, score: null, media: null };
    const promotores = vals.filter((v) => v >= 9).length;
    const neutros = vals.filter((v) => v >= 7 && v <= 8).length;
    const detratores = vals.filter((v) => v <= 6).length;
    return {
      n,
      promotores, neutros, detratores,
      pctPromotores: (promotores / n) * 100,
      pctNeutros: (neutros / n) * 100,
      pctDetratores: (detratores / n) * 100,
      score: ((promotores - detratores) / n) * 100,
      media: media(vals),
    };
  }

  /** Faixa de leitura do NPS. Rótulo + token de status (nunca cor sozinha). */
  function faixaNps(score) {
    if (score == null) return { rotulo: 'sem dados', status: 'neutro', icone: '–' };
    if (score >= 50) return { rotulo: 'excelente', status: 'good', icone: '▲' };
    if (score >= 0) return { rotulo: 'razoável', status: 'warning', icone: '◆' };
    if (score >= -50) return { rotulo: 'crítico', status: 'serious', icone: '▼' };
    return { rotulo: 'muito crítico', status: 'critical', icone: '▼' };
  }

  /* ---------------- Escalas 1–5 ---------------- */

  /** Média de todas as respostas de escala de um registro. */
  function mediaRegistro(r) {
    return media(DIM_IDS.map((id) => r[id]));
  }

  /** Média geral da amostra (média das médias por resposta). */
  function mediaGeral(records) {
    return media(records.map(mediaRegistro));
  }

  /** Estatísticas de uma dimensão: média, n, distribuição 1–5 e grupos. */
  function dimensao(records, dimId) {
    const vals = records.map((r) => r[dimId]).filter((v) => num(v) !== null);
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    vals.forEach((v) => { const k = Math.min(5, Math.max(1, Math.round(v))); dist[k]++; });
    const n = vals.length;
    const neg = dist[1] + dist[2];
    const neu = dist[3];
    const pos = dist[4] + dist[5];
    return {
      id: dimId,
      curto: (DIMS.find((d) => d.id === dimId) || {}).curto || dimId,
      longo: (DIMS.find((d) => d.id === dimId) || {}).longo || dimId,
      n, media: media(vals), dist,
      neg, neu, pos,
      pctNeg: n ? (neg / n) * 100 : null,
      pctNeu: n ? (neu / n) * 100 : null,
      pctPos: n ? (pos / n) * 100 : null,
    };
  }

  /** Todas as dimensões, na ordem do config. */
  function dimensoes(records) {
    return DIMS.map((d) => dimensao(records, d.id));
  }

  /* ---------------- Setores ---------------- */

  function setores(records) {
    const mapa = new Map();
    records.forEach((r) => {
      const k = r.departamento || 'Não informado';
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(r);
    });
    return Array.from(mapa.entries())
      .map(([setor, regs]) => {
        const dimMap = {};
        DIM_IDS.forEach((id) => { dimMap[id] = media(regs.map((r) => r[id])); });
        return {
          setor,
          n: regs.length,
          media: mediaGeral(regs),
          nps: nps(regs),
          dims: dimMap,
          registros: regs,
        };
      })
      .sort((a, b) => b.n - a.n || a.setor.localeCompare(b.setor, 'pt-BR'));
  }

  /* ---------------- Desafios (múltipla escolha) ---------------- */

  function desafios(records) {
    const total = records.length;
    const conta = new Map();
    window.APP.ASPECTOS.forEach((a) => conta.set(a, 0));
    records.forEach((r) => {
      (r.aspectos || []).forEach((a) => conta.set(a, (conta.get(a) || 0) + 1));
    });
    return Array.from(conta.entries())
      .map(([label, n]) => ({ label, n, pct: total ? (n / total) * 100 : 0 }))
      .filter((d) => d.n > 0 || window.APP.ASPECTOS.includes(d.label))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'pt-BR'));
  }

  /* ---------------- Linha do tempo (mensal) ---------------- */

  function linhaDoTempo(records) {
    const validos = records.filter((r) => !isNaN(new Date(r.timestamp)) && new Date(r.timestamp).getFullYear() > 1971);
    if (!validos.length) return [];
    const conta = new Map();
    validos.forEach((r) => {
      const d = new Date(r.timestamp);
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      if (!conta.has(k)) conta.set(k, []);
      conta.get(k).push(r);
    });
    const chaves = Array.from(conta.keys()).sort();
    // Preenche meses vazios para a linha não mentir sobre o intervalo.
    const [a0, m0] = chaves[0].split('-').map(Number);
    const [a1, m1] = chaves[chaves.length - 1].split('-').map(Number);
    const saida = [];
    let ano = a0, mes = m0;
    while (ano < a1 || (ano === a1 && mes <= m1)) {
      const k = ano + '-' + String(mes).padStart(2, '0');
      const regs = conta.get(k) || [];
      saida.push({
        chave: k,
        label: new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
        labelLongo: new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
        n: regs.length,
        media: mediaGeral(regs),
      });
      mes++; if (mes > 12) { mes = 1; ano++; }
    }
    return saida;
  }

  /* ---------------- Comentários abertos ---------------- */

  function verbatims(records, campoIds) {
    const ids = campoIds && campoIds.length ? campoIds : window.APP.ABERTAS.map((a) => a.id);
    const saida = [];
    records.forEach((r) => {
      ids.forEach((id) => {
        const txt = (r[id] || '').trim();
        if (!txt) return;
        const meta = window.APP.ABERTAS.find((a) => a.id === id);
        saida.push({
          id: r.id, campo: id,
          pergunta: meta ? meta.titulo : id,
          texto: txt,
          setor: r.departamento, cargo: r.cargo,
          nps: r.nps, timestamp: r.timestamp,
        });
      });
    });
    return saida.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  }

  function totalComentarios(records) {
    return verbatims(records).length;
  }

  /* ---------------- Filtro compartilhado ---------------- */

  /**
   * @param {object} f
   *   f.setor   string | '' (todos)
   *   f.dias    number | 0  (0 = sem limite)
   *   f.perfil  'promotor' | 'neutro' | 'detrator' | ''
   *   f.busca   string
   */
  function filtrar(records, f) {
    const filtro = f || {};
    const corte = filtro.dias
      ? Date.now() - filtro.dias * 86400000
      : null;
    const busca = (filtro.busca || '').trim().toLowerCase();

    return records.filter((r) => {
      if (filtro.setor && r.departamento !== filtro.setor) return false;
      if (corte) {
        const t = new Date(r.timestamp).getTime();
        if (!Number.isFinite(t) || t < corte) return false;
      }
      if (filtro.perfil && perfilNps(r.nps) !== filtro.perfil) return false;
      if (busca) {
        const alvo = [
          r.nome, r.cargo, r.departamento, r.superior,
          (r.aspectos || []).join(' '),
          r.lideranca_detalhe, r.voltaria, r.tres_pontos, r.evitar, r.comentarios,
        ].join(' ').toLowerCase();
        if (!alvo.includes(busca)) return false;
      }
      return true;
    });
  }

  /* ---------------- Preenchimento ---------------- */

  /** Quantos campos de um registro foram efetivamente respondidos. */
  function completude(r) {
    const campos = window.APP.CAMPOS.filter((c) => c.id !== 'timestamp');
    let feitos = 0;
    campos.forEach((c) => {
      const v = r[c.id];
      if (Array.isArray(v) ? v.length : (v !== '' && v != null)) feitos++;
    });
    return feitos / campos.length;
  }

  function completudeMedia(records) {
    if (!records.length) return null;
    return media(records.map(completude));
  }

  return {
    media, mediaRegistro, mediaGeral,
    nps, perfilNps, faixaNps,
    dimensao, dimensoes,
    setores, desafios, linhaDoTempo,
    verbatims, totalComentarios,
    filtrar, completude, completudeMedia,
    fmt1, fmt2, fmtInt, fmtPct, fmtSigned, fmtNps, fmtData, fmtDataHora,
  };
})();
