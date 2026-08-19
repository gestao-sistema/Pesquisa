/* =========================================================
   usuarios.mjs — usuários e sessões.

   Duas implementações atrás da mesma interface:
   • Postgres, quando existe DATABASE_URL (produção)
   • memória, quando não existe (rodar local sem instalar banco)

   Em memória tudo se perde ao reiniciar, e isso é dito em voz alta no
   log. Não há dado real a proteger nesse modo: as respostas também
   ficam só no navegador de quem responde.
   ========================================================= */

import { randomBytes } from 'node:crypto';
import { gerarHash, normalizarEmail } from './auth.mjs';

/* Contas criadas no primeiro boot. Trocáveis por variável de ambiente,
   para a senha inicial não ficar registrada num repositório. */
export const EMAIL_RH = normalizarEmail(process.env.EMAIL_RH || 'RH@azime.com.br');
export const EMAIL_TI = normalizarEmail(process.env.EMAIL_TI || 'TI@azime.com.br');
const SENHA_INICIAL = process.env.SENHA_INICIAL || 'AZIME2026';

export const DURACAO_SESSAO_H = Number(process.env.HORAS_SESSAO || 12);

/* Alavanca de emergência ("break glass"). Só o TI redefine senha, e só outro
   TI redefiniria a do TI — com uma única conta de TI, esquecer a senha
   trancaria a administração para sempre. Definindo RESET_SENHA_TI e
   reiniciando, a conta de TI volta a ter essa senha, marcada como
   provisória. Não é uma porta dos fundos permanente: enquanto a variável
   existir, todo reinício redefine a senha, e o servidor grita no log
   pedindo para removê-la. */
const RESET_SENHA_TI = process.env.RESET_SENHA_TI || '';

function novoId() {
  return 'u' + randomBytes(9).toString('base64url');
}

const SQL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS usuarios (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    nome          TEXT NOT NULL DEFAULT '',
    papel         TEXT NOT NULL,
    senha_hash    TEXT NOT NULL,
    provisoria    BOOLEAN NOT NULL DEFAULT false,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_por    TEXT NOT NULL DEFAULT '',
    ultimo_acesso TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS sessoes (
    token_hash TEXT PRIMARY KEY,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_em  TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessoes_usuario_idx ON sessoes (usuario_id);
  CREATE INDEX IF NOT EXISTS sessoes_expira_idx  ON sessoes (expira_em);
`;

/** Forma pública de um usuário: nunca inclui o hash da senha. */
export function usuarioPublico(u) {
  if (!u) return null;
  const iso = (v) => (v instanceof Date ? v.toISOString() : (v || null));
  return {
    id: u.id,
    email: u.email,
    nome: u.nome || '',
    papel: u.papel,
    provisoria: !!u.provisoria,
    criadoEm: iso(u.criado_em),
    criadoPor: u.criado_por || '',
    ultimoAcesso: iso(u.ultimo_acesso),
  };
}

/* ============================================================
   Postgres
   ============================================================ */

function lojaPostgres(pool) {
  let pronto = null;

  function preparar() {
    if (!pronto) {
      pronto = pool.query(SQL_SCHEMA)
        .then(semear)
        .then(aplicarResetEmergencia)
        .catch((err) => { pronto = null; throw err; });
    }
    return pronto;
  }

  async function semear() {
    const { rows } = await pool.query('SELECT count(*)::int AS total FROM usuarios');
    if (rows[0].total > 0) return;
    const hash = await gerarHash(SENHA_INICIAL);
    for (const [email, papel, nome] of [[EMAIL_RH, 'rh', 'RH'], [EMAIL_TI, 'ti', 'TI']]) {
      await pool.query(
        `INSERT INTO usuarios (id, email, nome, papel, senha_hash, provisoria, criado_por)
         VALUES ($1, $2, $3, $4, $5, true, 'sistema')
         ON CONFLICT (email) DO NOTHING`,
        [novoId(), email, nome, papel, hash]
      );
    }
    console.log(`[auth] contas iniciais criadas: ${EMAIL_RH} e ${EMAIL_TI} `
      + '— senha provisória, troca obrigatória no primeiro acesso');
  }

  async function aplicarResetEmergencia() {
    if (!RESET_SENHA_TI) return;
    const hash = await gerarHash(RESET_SENHA_TI);
    const { rowCount } = await pool.query(
      `UPDATE usuarios SET senha_hash = $2, provisoria = true
        WHERE email = $1 AND papel = 'ti'`,
      [EMAIL_TI, hash]
    );
    if (!rowCount) {
      // Conta apagada direto no banco: recria, senão não sobra administrador.
      await pool.query(
        `INSERT INTO usuarios (id, email, nome, papel, senha_hash, provisoria, criado_por)
         VALUES ($1, $2, 'TI', 'ti', $3, true, 'emergencia')
         ON CONFLICT (email) DO UPDATE SET senha_hash = $3, papel = 'ti', provisoria = true`,
        [novoId(), EMAIL_TI, hash]
      );
      console.warn(`[auth] RESET_SENHA_TI: conta ${EMAIL_TI} não existia e foi recriada.`);
    }
    // Quem estivesse dentro com a conta de TI cai.
    await pool.query(
      'DELETE FROM sessoes WHERE usuario_id IN (SELECT id FROM usuarios WHERE email = $1)',
      [EMAIL_TI]
    );
    console.warn('====================================================================\n'
      + `[auth] SENHA DE ${EMAIL_TI} REDEFINIDA pela variável RESET_SENHA_TI.\n`
      + '[auth] Entre agora, defina uma senha nova e REMOVA essa variável do\n'
      + '[auth] ambiente. Enquanto ela existir, todo reinício redefine a senha.\n'
      + '====================================================================');
  }

  async function buscarPorId(id) {
    await preparar();
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [String(id)]);
    return rows[0] || null;
  }

  return {
    preparar,
    buscarPorId,

    async buscarPorEmail(email) {
      await preparar();
      const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1',
        [normalizarEmail(email)]);
      return rows[0] || null;
    },

    async listar() {
      await preparar();
      const { rows } = await pool.query('SELECT * FROM usuarios ORDER BY papel, email');
      return rows.map(usuarioPublico);
    },

    async contarPorPapel(papel) {
      await preparar();
      const { rows } = await pool.query(
        'SELECT count(*)::int AS total FROM usuarios WHERE papel = $1', [papel]);
      return rows[0].total;
    },

    async criar({ email, nome, papel, senhaHash, provisoria, criadoPor }) {
      await preparar();
      const id = novoId();
      await pool.query(
        `INSERT INTO usuarios (id, email, nome, papel, senha_hash, provisoria, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, normalizarEmail(email), String(nome || '').slice(0, 120), papel,
          senhaHash, !!provisoria, String(criadoPor || '').slice(0, 160)]
      );
      return usuarioPublico(await buscarPorId(id));
    },

    async apagar(id) {
      await preparar();
      const { rowCount } = await pool.query('DELETE FROM usuarios WHERE id = $1', [String(id)]);
      return rowCount > 0;
    },

    async definirSenha(id, senhaHash, provisoria) {
      await preparar();
      const { rowCount } = await pool.query(
        'UPDATE usuarios SET senha_hash = $2, provisoria = $3 WHERE id = $1',
        [String(id), senhaHash, !!provisoria]);
      return rowCount > 0;
    },

    async marcarAcesso(id) {
      await pool.query('UPDATE usuarios SET ultimo_acesso = now() WHERE id = $1', [String(id)]);
    },

    /* ---- sessões ---- */

    async criarSessao(usuarioId, tokenHash, expiraEm) {
      await preparar();
      await pool.query(
        'INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES ($1, $2, $3)',
        [tokenHash, String(usuarioId), expiraEm]);
    },

    async buscarSessao(tokenHash) {
      await preparar();
      const { rows } = await pool.query(
        `SELECT s.token_hash, s.expira_em, u.*
           FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
          WHERE s.token_hash = $1 AND s.expira_em > now()`,
        [tokenHash]);
      return rows[0] || null;
    },

    async renovarSessao(tokenHash, expiraEm) {
      await pool.query('UPDATE sessoes SET expira_em = $2 WHERE token_hash = $1',
        [tokenHash, expiraEm]);
    },

    async apagarSessao(tokenHash) {
      await pool.query('DELETE FROM sessoes WHERE token_hash = $1', [tokenHash]);
    },

    async apagarSessoesDoUsuario(usuarioId) {
      await pool.query('DELETE FROM sessoes WHERE usuario_id = $1', [String(usuarioId)]);
    },

    async limparExpiradas() {
      const { rowCount } = await pool.query('DELETE FROM sessoes WHERE expira_em <= now()');
      return rowCount;
    },
  };
}

/* ============================================================
   Memória (sem DATABASE_URL)
   ============================================================ */

function lojaMemoria() {
  const usuarios = new Map();   // id -> registro
  const sessoes = new Map();    // tokenHash -> {usuarioId, expiraEm}
  let pronto = null;

  function preparar() {
    if (!pronto) pronto = semear();
    return pronto;
  }

  async function semear() {
    /* Em memória o reset de emergência é irrelevante — reiniciar já devolve
       a senha inicial — mas respeitá-lo mantém o comportamento igual ao de
       produção, o que evita surpresa ao testar a variável localmente. */
    const hash = await gerarHash(RESET_SENHA_TI || SENHA_INICIAL);
    const hashRh = RESET_SENHA_TI ? await gerarHash(SENHA_INICIAL) : hash;
    for (const [email, papel, nome] of [[EMAIL_RH, 'rh', 'RH'], [EMAIL_TI, 'ti', 'TI']]) {
      const id = novoId();
      usuarios.set(id, {
        id, email, nome, papel,
        senha_hash: papel === 'ti' ? hash : hashRh,
        provisoria: true,
        criado_em: new Date(), criado_por: 'sistema', ultimo_acesso: null,
      });
    }
    console.warn('[auth] MODO MEMÓRIA — usuários e sessões se perdem ao reiniciar. '
      + `Contas: ${EMAIL_RH} e ${EMAIL_TI}, senha provisória.`);
    if (RESET_SENHA_TI) {
      console.warn(`[auth] RESET_SENHA_TI ativo: ${EMAIL_TI} usa a senha dessa variável.`);
    }
  }

  const porId = (id) => usuarios.get(String(id)) || null;

  return {
    preparar,

    async buscarPorId(id) { await preparar(); return porId(id); },

    async buscarPorEmail(email) {
      await preparar();
      const alvo = normalizarEmail(email);
      for (const u of usuarios.values()) if (u.email === alvo) return u;
      return null;
    },

    async listar() {
      await preparar();
      return [...usuarios.values()]
        .sort((a, b) => a.papel.localeCompare(b.papel) || a.email.localeCompare(b.email))
        .map(usuarioPublico);
    },

    async contarPorPapel(papel) {
      await preparar();
      return [...usuarios.values()].filter((u) => u.papel === papel).length;
    },

    async criar({ email, nome, papel, senhaHash, provisoria, criadoPor }) {
      await preparar();
      const id = novoId();
      usuarios.set(id, {
        id, email: normalizarEmail(email), nome: String(nome || '').slice(0, 120), papel,
        senha_hash: senhaHash, provisoria: !!provisoria,
        criado_em: new Date(), criado_por: String(criadoPor || ''), ultimo_acesso: null,
      });
      return usuarioPublico(porId(id));
    },

    async apagar(id) {
      await preparar();
      for (const [th, s] of sessoes) if (s.usuarioId === String(id)) sessoes.delete(th);
      return usuarios.delete(String(id));
    },

    async definirSenha(id, senhaHash, provisoria) {
      await preparar();
      const u = porId(id);
      if (!u) return false;
      u.senha_hash = senhaHash;
      u.provisoria = !!provisoria;
      return true;
    },

    async marcarAcesso(id) {
      const u = porId(id);
      if (u) u.ultimo_acesso = new Date();
    },

    async criarSessao(usuarioId, tokenHash, expiraEm) {
      await preparar();
      sessoes.set(tokenHash, { usuarioId: String(usuarioId), expiraEm: new Date(expiraEm) });
    },

    async buscarSessao(tokenHash) {
      await preparar();
      const s = sessoes.get(tokenHash);
      if (!s) return null;
      if (s.expiraEm <= new Date()) { sessoes.delete(tokenHash); return null; }
      const u = porId(s.usuarioId);
      if (!u) { sessoes.delete(tokenHash); return null; }
      return { ...u, token_hash: tokenHash, expira_em: s.expiraEm };
    },

    async renovarSessao(tokenHash, expiraEm) {
      const s = sessoes.get(tokenHash);
      if (s) s.expiraEm = new Date(expiraEm);
    },

    async apagarSessao(tokenHash) { sessoes.delete(tokenHash); },

    async apagarSessoesDoUsuario(usuarioId) {
      for (const [th, s] of sessoes) if (s.usuarioId === String(usuarioId)) sessoes.delete(th);
    },

    async limparExpiradas() {
      const agora = new Date();
      let n = 0;
      for (const [th, s] of sessoes) if (s.expiraEm <= agora) { sessoes.delete(th); n++; }
      return n;
    },
  };
}

/**
 * @param {object|null} pool  pool do pg, ou null para modo memória
 */
export function criarLojaUsuarios(pool) {
  return pool ? lojaPostgres(pool) : lojaMemoria();
}
