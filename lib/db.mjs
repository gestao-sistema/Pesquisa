/* =========================================================
   db.mjs — Postgres.

   No Railway: adicione o plugin Postgres ao projeto e ele injeta
   DATABASE_URL sozinho. Nada mais para configurar.

   O schema é criado no boot (CREATE TABLE IF NOT EXISTS), então
   não existe passo separado de migração para o primeiro deploy.

   Uma coluna por campo — em vez de um JSONB só — porque o RH
   eventualmente vai querer consultar isto em SQL, e
   `WHERE departamento = 'Produção' AND scale_chefia <= 2`
   é bem mais útil que navegar dentro de um JSON.
   ========================================================= */

import pg from 'pg';
import { CAMPOS_TEXTO, CAMPOS_ESCALA } from './resposta.mjs';

/* Ordem das colunas usada no INSERT e no SELECT. Deriva de resposta.mjs,
   então acrescentar um campo lá basta para ele aparecer aqui. */
const COLUNAS = ['id', 'respondido_em', 'aspectos', 'nps', ...CAMPOS_TEXTO, ...CAMPOS_ESCALA];

function sqlSchema() {
  const texto = CAMPOS_TEXTO.map((c) => `  ${c} TEXT NOT NULL DEFAULT ''`).join(',\n');
  const escala = CAMPOS_ESCALA.map((c) => `  ${c} SMALLINT`).join(',\n');
  return `
    CREATE TABLE IF NOT EXISTS respostas (
      id            TEXT PRIMARY KEY,
      respondido_em TIMESTAMPTZ NOT NULL,
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
      aspectos      TEXT[] NOT NULL DEFAULT '{}',
      nps           SMALLINT,
${texto},
${escala}
    );
    CREATE INDEX IF NOT EXISTS respostas_respondido_em_idx
      ON respostas (respondido_em DESC);
    CREATE INDEX IF NOT EXISTS respostas_departamento_idx
      ON respostas (departamento);
  `;
}

/** Converte uma linha do banco no formato que o frontend consome. */
function paraJson(linha) {
  const r = {
    id: linha.id,
    timestamp: linha.respondido_em instanceof Date
      ? linha.respondido_em.toISOString()
      : String(linha.respondido_em),
    aspectos: Array.isArray(linha.aspectos) ? linha.aspectos : [],
    nps: linha.nps == null ? null : Number(linha.nps),
  };
  CAMPOS_TEXTO.forEach((c) => { r[c] = linha[c] || ''; });
  CAMPOS_ESCALA.forEach((c) => { r[c] = linha[c] == null ? null : Number(linha[c]); });
  return r;
}

export function criarBanco(url) {
  const pool = new pg.Pool({
    connectionString: url,
    // O Postgres do Railway usa certificado próprio na rede pública.
    // Dentro da rede interna do projeto (*.railway.internal) não há TLS.
    ssl: /railway|render|supabase|neon|amazonaws/.test(url) && !/\.railway\.internal/.test(url)
      ? { rejectUnauthorized: false }
      : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
  });

  pool.on('error', (err) => {
    console.error('[db] erro no pool ocioso:', err.message);
  });

  let pronto = null;

  /** Cria o schema uma vez; chamadas seguintes reaproveitam a promessa. */
  function preparar() {
    if (!pronto) {
      pronto = pool.query(sqlSchema())
        .then(() => { console.log('[db] schema pronto'); })
        .catch((err) => { pronto = null; throw err; });
    }
    return pronto;
  }

  async function listar() {
    await preparar();
    const { rows } = await pool.query(
      `SELECT ${COLUNAS.join(', ')} FROM respostas ORDER BY respondido_em DESC`
    );
    return rows.map(paraJson);
  }

  async function gravar(reg) {
    await preparar();
    const valores = COLUNAS.map((c) => {
      if (c === 'respondido_em') return reg.timestamp;
      if (c === 'aspectos') return reg.aspectos;
      return reg[c];
    });
    const marcadores = COLUNAS.map((_, i) => '$' + (i + 1)).join(', ');
    // ON CONFLICT: reenvio da fila local não duplica a resposta.
    await pool.query(
      `INSERT INTO respostas (${COLUNAS.join(', ')}) VALUES (${marcadores})
       ON CONFLICT (id) DO NOTHING`,
      valores
    );
    return reg.id;
  }

  async function saude() {
    await preparar();
    const { rows } = await pool.query('SELECT count(*)::int AS total FROM respostas');
    return { total: rows[0].total };
  }

  async function fechar() { await pool.end(); }

  // O pool sai junto para lib/usuarios.mjs reaproveitar: dois pools de 5
  // conexões contra o mesmo Postgres seria desperdício.
  return { listar, gravar, saude, fechar, preparar, pool };
}

export const _internos = { sqlSchema, paraJson, COLUNAS };
