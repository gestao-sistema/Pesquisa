/* =========================================================
   limite.mjs — freio nas tentativas de login.

   Duas travas com propósitos diferentes:

   • por IP — trava dura. Depois de 10 falhas, 10 minutos de bloqueio.
     É contra quem varre senhas em volume.

   • por conta — atraso crescente, NUNCA bloqueio. Cada falha recente
     soma 400ms de espera, até 4s. Bloquear por e-mail pareceria mais
     seguro, mas entregaria um jeito trivial de trancar o RH de fora:
     bastaria errar a senha dele algumas vezes. Atrasar atrapalha quem
     está adivinhando e não impede quem sabe a senha.

   Tudo em memória: reiniciar o servidor zera as contagens. Para o
   volume de uma pesquisa interna isso basta, e evita escrever no banco
   a cada tentativa errada — o que seria, por si só, um vetor de abuso.
   ========================================================= */

const JANELA_MS = 15 * 60 * 1000;      // falhas mais antigas que isso são esquecidas

export const IP_MAX_FALHAS = 10;
export const IP_BLOQUEIO_MS = 10 * 60 * 1000;

export const CONTA_ATRASO_BASE_MS = 600;
export const CONTA_ATRASO_POR_FALHA_MS = 400;
export const CONTA_ATRASO_MAX_MS = 4000;

export function criarLimite(agora = () => Date.now()) {
  const porIp = new Map();     // ip -> {falhas: number[], bloqueadoAte: number}
  const porConta = new Map();  // email -> number[] (instantes das falhas)

  function limpar(lista, t) {
    const corte = t - JANELA_MS;
    let i = 0;
    while (i < lista.length && lista[i] < corte) i++;
    if (i) lista.splice(0, i);
    return lista;
  }

  /** Quanto falta de bloqueio para este IP, em ms. 0 = liberado. */
  function bloqueioRestante(ip) {
    const reg = porIp.get(ip);
    if (!reg) return 0;
    const t = agora();
    if (reg.bloqueadoAte > t) return reg.bloqueadoAte - t;
    return 0;
  }

  /** Espera a aplicar antes de responder a uma tentativa desta conta. */
  function atrasoDaConta(email) {
    const lista = limpar(porConta.get(email) || [], agora());
    return Math.min(
      CONTA_ATRASO_BASE_MS + lista.length * CONTA_ATRASO_POR_FALHA_MS,
      CONTA_ATRASO_MAX_MS
    );
  }

  function registrarFalha(ip, email) {
    const t = agora();

    if (ip) {
      const reg = porIp.get(ip) || { falhas: [], bloqueadoAte: 0 };
      limpar(reg.falhas, t).push(t);
      if (reg.falhas.length >= IP_MAX_FALHAS) {
        reg.bloqueadoAte = t + IP_BLOQUEIO_MS;
        reg.falhas.length = 0;          // recomeça a contagem depois do bloqueio
      }
      porIp.set(ip, reg);
    }

    if (email) {
      const lista = limpar(porConta.get(email) || [], t);
      lista.push(t);
      porConta.set(email, lista);
    }
  }

  /** Login certo limpa o histórico dos dois lados. */
  function registrarAcerto(ip, email) {
    if (ip) porIp.delete(ip);
    if (email) porConta.delete(email);
  }

  /** Faxina periódica, para o mapa não crescer para sempre. */
  function podar() {
    const t = agora();
    for (const [ip, reg] of porIp) {
      limpar(reg.falhas, t);
      if (!reg.falhas.length && reg.bloqueadoAte <= t) porIp.delete(ip);
    }
    for (const [email, lista] of porConta) {
      limpar(lista, t);
      if (!lista.length) porConta.delete(email);
    }
    return { ips: porIp.size, contas: porConta.size };
  }

  return {
    bloqueioRestante, atrasoDaConta, registrarFalha, registrarAcerto, podar,
    get tamanho() { return { ips: porIp.size, contas: porConta.size }; },
  };
}

/** IP de quem chamou. Atrás do roteador do Railway vem em x-forwarded-for. */
export function ipDaRequisicao(req) {
  const enc = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return enc || req.socket?.remoteAddress || 'desconhecido';
}

/** "10 minutos", "3 minutos", "40 segundos" — para a mensagem de erro. */
export function formatarEspera(ms) {
  const seg = Math.ceil(ms / 1000);
  if (seg < 60) return `${seg} segundo${seg === 1 ? '' : 's'}`;
  const min = Math.ceil(seg / 60);
  return `${min} minuto${min === 1 ? '' : 's'}`;
}
