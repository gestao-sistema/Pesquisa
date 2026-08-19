/* =========================================================
   store.js — camada de dados.

   Dois modos, decididos em tempo de execução:

   • "api"   → /api/responses, servido pelo server.js contra o
               Postgres. Armazenamento compartilhado: todo mundo vê as
               mesmas respostas. É o modo em produção.
   • "local" → localStorage do navegador. Entra em cena quando a API
               não responde (arquivo aberto direto do disco, `file://`,
               ou servidor sem DATABASE_URL). Serve para demonstrar e
               testar sem banco.

   Em qualquer modo o localStorage guarda um espelho: se o envio
   falhar, a resposta fica numa fila e é reenviada na próxima carga.
   ========================================================= */

window.Store = (function () {
  const API = '/api/responses';
  const LS_DATA = 'pd:respostas';
  const LS_QUEUE = 'pd:pendentes';

  let _mode = null;          // 'api' | 'local'
  let _readyPromise = null;

  /* ---------------- utilidades ---------------- */

  function lsRead(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch { return []; }
  }
  function lsWrite(key, arr) {
    try { localStorage.setItem(key, JSON.stringify(arr)); return true; }
    catch { return false; }
  }

  function uid() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  const SCALE_IDS = window.APP.DIMENSOES.map((d) => d.id);

  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function toList(v) {
    if (Array.isArray(v)) return v.filter((x) => x !== '' && x != null);
    if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  }

  function toText(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.join(', ');
    return String(v).trim();
  }

  /* Normaliza um registro vindo de qualquer origem (API, localStorage,
     dados de exemplo) para a mesma forma. Faz o setor "Outro" virar o
     texto informado, para o agrupamento por setor ficar honesto. */
  function normalize(raw) {
    const r = raw || {};
    const setorBruto = toText(r.departamento);
    const setorOutro = toText(r.departamento_outro);
    const setor = setorBruto === 'Outro' && setorOutro
      ? setorOutro
      : (setorBruto || 'Não informado');

    const out = {
      id: r.id || uid(),
      timestamp: r.timestamp || new Date(0).toISOString(),
      nome: toText(r.nome),
      cargo: toText(r.cargo),
      departamento: setor,
      departamento_raw: setorBruto,
      superior: toText(r.superior),
      aspectos: toList(r.aspectos),
      lideranca_detalhe: toText(r.lideranca_detalhe),
      voltaria: toText(r.voltaria),
      tres_pontos: toText(r.tres_pontos),
      nps: toNum(r.nps),
      evitar: toText(r.evitar),
      comentarios: toText(r.comentarios),
    };
    SCALE_IDS.forEach((id) => { out[id] = toNum(r[id]); });
    return out;
  }

  function sortDesc(list) {
    return list.slice().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  }

  /* ---------------- detecção de modo ---------------- */

  async function probe() {
    try {
      const res = await fetch(API, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('formato inesperado');
      _mode = 'api';
      return data;
    } catch {
      _mode = 'local';
      return null;
    }
  }

  async function flushQueue() {
    if (_mode !== 'api') return;
    const queue = lsRead(LS_QUEUE);
    if (!queue.length) return;
    const restantes = [];
    for (const rec of queue) {
      const ok = await postOne(rec);
      if (!ok) restantes.push(rec);
    }
    lsWrite(LS_QUEUE, restantes);
  }

  async function postOne(rec) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rec),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  function ready() {
    if (!_readyPromise) {
      _readyPromise = (async () => {
        const first = await probe();
        await flushQueue();
        return first;
      })();
    }
    return _readyPromise;
  }

  /* ---------------- API pública ---------------- */

  /** Lista todas as respostas, mais recentes primeiro. */
  async function list() {
    const first = await ready();
    if (_mode === 'api') {
      // `first` é o resultado do probe; recarrega se já foi consumido.
      const data = first && !list._consumed ? first : await refetch();
      list._consumed = true;
      const remotos = (data || []).map(normalize);
      // Pendentes ainda não sincronizados aparecem no painel de imediato.
      const pendentes = lsRead(LS_QUEUE).map(normalize);
      const vistos = new Set(remotos.map((r) => r.id));
      return sortDesc(remotos.concat(pendentes.filter((p) => !vistos.has(p.id))));
    }
    return sortDesc(lsRead(LS_DATA).map(normalize));
  }

  async function refetch() {
    try {
      const res = await fetch(API, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error('http ' + res.status);
      return await res.json();
    } catch {
      _mode = 'local';
      return lsRead(LS_DATA);
    }
  }

  /** Grava uma resposta. Nunca rejeita: cai para a fila local. */
  async function add(answers) {
    const rec = normalize({ ...answers, id: uid(), timestamp: new Date().toISOString() });
    await ready();

    let enviado = false;
    if (_mode === 'api') enviado = await postOne(rec);

    if (!enviado) {
      if (_mode === 'api') {
        lsWrite(LS_QUEUE, lsRead(LS_QUEUE).concat([rec]));   // reenvia depois
      } else {
        lsWrite(LS_DATA, lsRead(LS_DATA).concat([rec]));     // modo local é o destino final
      }
    }
    return { ok: true, sincronizado: enviado, modo: _mode, registro: rec };
  }

  /** Grava vários registros de uma vez (usado pelos dados de exemplo). */
  async function addMany(registros) {
    await ready();
    const normalizados = registros.map((x) => normalize({ ...x, id: x.id || uid() }));

    if (_mode === 'api') {
      // Em lotes, para não abrir 140 conexões ao mesmo tempo.
      const LOTE = 8;
      for (let i = 0; i < normalizados.length; i += LOTE) {
        await Promise.all(normalizados.slice(i, i + LOTE).map(postOne));
      }
      return normalizados.length;
    }

    lsWrite(LS_DATA, lsRead(LS_DATA).concat(normalizados));
    return normalizados.length;
  }

  /** Substitui todo o conjunto local (usado pelos dados de exemplo). */
  function seedLocal(registros) {
    return lsWrite(LS_DATA, registros.map((x) => normalize({ ...x, id: x.id || uid() })));
  }

  /** Apaga o conjunto local. Não toca no armazenamento compartilhado. */
  function clearLocal() {
    lsWrite(LS_DATA, []);
    lsWrite(LS_QUEUE, []);
  }

  function mode() { return _mode; }

  return { ready, list, add, addMany, seedLocal, clearLocal, mode, normalize };
})();
