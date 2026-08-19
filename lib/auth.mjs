/* =========================================================
   auth.mjs — senhas, sessões, cookies e as regras de papel.

   Sem dependência: scrypt e randomBytes vêm do node:crypto.

   A senha nunca é guardada, nem em texto nem em cifra reversível:
   guarda-se o resultado de scrypt com sal próprio por usuário. O token
   de sessão também não é guardado — guarda-se o SHA-256 dele, para que
   um vazamento do banco não permita se passar por ninguém.
   ========================================================= */

import {
  scrypt, randomBytes, timingSafeEqual, createHash,
} from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/* N=16384 leva ~50-100ms num container pequeno: caro o bastante para
   atrapalhar força bruta, barato o bastante para o login não travar. */
const N = 16384, R = 8, P = 1, TAM = 64;

export const SENHA_MINIMA = 8;

/** Hash de uma senha. Formato: scrypt$N$r$p$sal$hash (base64). */
export async function gerarHash(senha) {
  const sal = randomBytes(16);
  const chave = await scryptAsync(String(senha), sal, TAM, { N, r: R, p: P });
  return ['scrypt', N, R, P, sal.toString('base64'), chave.toString('base64')].join('$');
}

/** Confere uma senha contra o hash guardado. Nunca lança. */
export async function conferirSenha(senha, guardado) {
  try {
    const partes = String(guardado || '').split('$');
    if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
    const n = Number(partes[1]), r = Number(partes[2]), p = Number(partes[3]);
    const sal = Buffer.from(partes[4], 'base64');
    const esperado = Buffer.from(partes[5], 'base64');
    const chave = await scryptAsync(String(senha), sal, esperado.length, { N: n, r, p });
    if (chave.length !== esperado.length) return false;
    return timingSafeEqual(chave, esperado);
  } catch {
    return false;
  }
}

/** Token de sessão: 32 bytes aleatórios. Vai para o cookie em claro. */
export function novoToken() {
  return randomBytes(32).toString('base64url');
}

/** O que vai para o banco: só o hash do token. */
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('base64');
}

/* ---------------- validação ---------------- */

export function normalizarEmail(v) {
  return String(v == null ? '' : v).trim().toLowerCase().slice(0, 160);
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailValido(v) {
  return RE_EMAIL.test(normalizarEmail(v));
}

/**
 * Regras de senha, deliberadamente curtas: exigir símbolo e maiúscula
 * empurra a pessoa para "Senha1!" ou para o post-it na mesa.
 * Comprimento é o que mais pesa.
 */
export function criticarSenha(senha, email) {
  const s = String(senha == null ? '' : senha);
  if (s.length < SENHA_MINIMA) return `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`;
  if (s.length > 200) return 'A senha é longa demais.';
  if (!/\d/.test(s) || !/[a-zA-Z]/.test(s)) return 'Misture letras e números.';
  if (email && s.toLowerCase() === normalizarEmail(email)) {
    return 'A senha não pode ser o próprio e-mail.';
  }
  return null;
}

/* ---------------- cookies ---------------- */

export const NOME_COOKIE = 'pd_sessao';

export function lerCookies(cabecalho) {
  const saida = {};
  String(cabecalho || '').split(';').forEach((parte) => {
    const i = parte.indexOf('=');
    if (i < 1) return;
    const nome = parte.slice(0, i).trim();
    const valor = parte.slice(i + 1).trim();
    if (nome) {
      try { saida[nome] = decodeURIComponent(valor); } catch { saida[nome] = valor; }
    }
  });
  return saida;
}

/**
 * Set-Cookie da sessão. `seguro` sai do x-forwarded-proto: no Railway o
 * TLS termina no roteador, então a requisição chega ao processo em http
 * e o req.socket.encrypted é falso mesmo num site https.
 */
export function cookieSessao(token, { seguro, maxIdade }) {
  const partes = [
    `${NOME_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',                 // fora do alcance de qualquer script na página
    'SameSite=Lax',             // sobrevive à navegação normal, barra POST de outro site
    `Max-Age=${Math.max(0, Math.floor(maxIdade))}`,
  ];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

export function cookieLimpo({ seguro }) {
  const partes = [`${NOME_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

/* ---------------- papéis ----------------

   Separação de responsabilidades de propósito:

   • RH  — lê os resultados da pesquisa; pode incluir outras contas de RH.
   • TI  — administra contas (incluir, excluir, redefinir senha) e
           NÃO tem acesso às respostas.

   Ou seja: quem administra o acesso não lê a entrevista de quem saiu,
   e quem lê a entrevista não distribui acesso a quem quiser.
   -------------------------------------------------------- */

export const PAPEIS = ['rh', 'ti'];

export const ROTULO_PAPEL = { rh: 'RH', ti: 'TI' };

export const DESCRICAO_PAPEL = {
  rh: 'Vê os resultados da pesquisa e pode incluir outras contas de RH.',
  ti: 'Administra contas (incluir, excluir, redefinir senha). Não acessa as respostas.',
};

/** Onde cada papel cai ao entrar. */
export function paginaInicial(papel) {
  return papel === 'ti' ? '/usuarios.html' : '/dashboard.html';
}

/** Ler respostas da pesquisa: só RH. */
export function podeVerRespostas(papel) {
  return papel === 'rh';
}

/** Abrir a tela de usuários: os dois, com poderes diferentes. */
export function podeAbrirUsuarios(papel) {
  return PAPEIS.includes(papel);
}

/** Quem pode criar quem: TI cria qualquer papel; RH só cria RH. */
export function podeCriarPapel(papelDeQuemCria, papelNovo) {
  if (papelDeQuemCria === 'ti') return PAPEIS.includes(papelNovo);
  if (papelDeQuemCria === 'rh') return papelNovo === 'rh';
  return false;
}

/** Excluir conta e redefinir senha de outra pessoa: exclusivo do TI. */
export function podeAdministrarContas(papel) {
  return papel === 'ti';
}
