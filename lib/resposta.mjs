/* =========================================================
   resposta.mjs — o formato canônico de uma resposta.

   Fica separado do servidor de propósito: é a única fonte de
   verdade sobre quais campos existem, seus tipos e seus limites.
   O servidor usa para sanear o que chega, e a camada de banco usa
   para montar as colunas — assim os dois nunca saem de sincronia.

   O endpoint é público (tem que ser: qualquer pessoa com o link
   responde a pesquisa), então nada entra na base sem passar aqui.
   ========================================================= */

export const CAMPOS_TEXTO = [
  'nome', 'cargo', 'departamento', 'departamento_outro', 'superior',
  'lideranca_detalhe', 'voltaria', 'tres_pontos', 'evitar', 'comentarios',
];

export const CAMPOS_ESCALA = [
  'scale_estrutura', 'scale_equipe', 'scale_organizacao', 'scale_chefia',
  'scale_crescimento', 'scale_salario', 'scale_reconhecimento',
  'scale_comunicacao', 'scale_equilibrio', 'scale_onboarding',
];

export const LIMITE_TEXTO = 4000;
export const LIMITE_CORPO = 64 * 1024;      // 64 KB por envio
export const LIMITE_ASPECTOS = 20;

/* Tira caracteres de controle (menos tab e quebra de linha): eles são
   inválidos em XML e derrubariam a exportação para Excel. */
function semControle(s) {
  let saida = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) continue;
    if (c === 127) continue;
    saida += ch;
  }
  return saida;
}

export function texto(v) {
  if (v == null) return '';
  return semControle(String(v)).trim().slice(0, LIMITE_TEXTO);
}

export function inteiro(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function lista(v) {
  const bruto = Array.isArray(v)
    ? v
    : (typeof v === 'string' && v.trim() ? v.split(',') : []);
  return bruto.map(texto).filter(Boolean).slice(0, LIMITE_ASPECTOS);
}

export function novoId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Valida ANTES de converter: `new Date('qualquer coisa').toISOString()`
   lança RangeError, e uma data malformada derrubaria a gravação. */
export function quando(v) {
  if (v == null || v === '') return new Date().toISOString();
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

/** Deixa passar só o formato conhecido, com tamanhos presos. */
export function sanear(corpo) {
  const reg = {
    id: /^[A-Za-z0-9_-]{1,40}$/.test(String(corpo.id || '')) ? String(corpo.id) : novoId(),
    timestamp: quando(corpo.timestamp),
    aspectos: lista(corpo.aspectos),
    nps: inteiro(corpo.nps, 0, 10),
  };
  CAMPOS_TEXTO.forEach((c) => { reg[c] = texto(corpo[c]); });
  CAMPOS_ESCALA.forEach((c) => { reg[c] = inteiro(corpo[c], 1, 5); });
  return reg;
}
