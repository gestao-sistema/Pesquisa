/* =========================================================
   server.js — o processo que roda no Railway.

   • serve os arquivos estáticos do site
   • /api/responses — GET exige sessão de RH; POST é público (é o
     endpoint da pesquisa: quem está saindo da empresa não tem conta)
   • /api/login, /api/logout, /api/eu, /api/senha
   • /api/usuarios — contas (TI inclui/exclui/redefine; RH só inclui RH)

   As telas de gestão são barradas no próprio servidor, não só no
   navegador: sem sessão, o HTML do painel nem chega a ser baixado.

   Sem framework: o http embutido do Node dá conta, e assim a única
   dependência do projeto é o driver do Postgres.
   ========================================================= */

import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanear, LIMITE_CORPO } from './lib/resposta.mjs';
import { criarBanco } from './lib/db.mjs';
import { criarLojaUsuarios, DURACAO_SESSAO_H } from './lib/usuarios.mjs';
import {
  gerarHash, conferirSenha, novoToken, hashToken,
  normalizarEmail, emailValido, criticarSenha,
  lerCookies, cookieSessao, cookieLimpo, NOME_COOKIE,
  PAPEIS, paginaInicial, podeVerRespostas, podeAbrirUsuarios,
  podeCriarPapel, podeAdministrarContas,
} from './lib/auth.mjs';
import { criarLimite, ipDaRequisicao, formatarEspera } from './lib/limite.mjs';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT) || 3000;
const URL_BANCO = process.env.DATABASE_URL || '';

const banco = URL_BANCO ? criarBanco(URL_BANCO) : null;
const contas = criarLojaUsuarios(banco ? banco.pool : null);
const limite = criarLimite();

/* Dados de exemplo gravam 160 respostas fictícias. Sem banco isso é
   inofensivo (fica no navegador de quem clicou), mas com Postgres ligado
   seria sujeira na base real — a dois cliques de distância. Por isso só
   liberamos quando não há banco, ou quando alguém pede explicitamente
   com PERMITIR_DEMO (útil num ambiente de teste com Postugres próprio). */
const DEMO_PERMITIDA = !banco || process.env.PERMITIR_DEMO === 'true';

if (!banco) {
  console.warn('[server] DATABASE_URL ausente — as respostas caem para o localStorage '
    + 'do navegador e as contas ficam só em memória.');
}

/* Estado dito em voz alta no boot, para dar para conferir no log do Railway
   sem precisar autenticar. */
console.log('[server] dados de exemplo: ' + (
  !banco ? 'permitidos (sem banco — ficam no navegador)'
    : DEMO_PERMITIDA ? 'PERMITIDOS por PERMITIR_DEMO=true — vão gravar respostas fictícias no Postgres'
      : 'bloqueados (banco de produção)'));

const MAX_IDADE = DURACAO_SESSAO_H * 3600;

/* ---------------- estáticos ---------------- */

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
};

/* Só o site vai para a rede. Código do servidor, dependências e arquivos
   de ambiente ficam de fora, por mais que estejam na mesma pasta. */
const BLOQUEADOS = [
  'server.js', 'package.json', 'package-lock.json', 'railway.json',
  'README.md', '.env', '.git', 'node_modules', 'lib',
];

/* Que permissão cada tela exige. O HTML em si não é sigiloso, mas negar
   já aqui evita o painel piscando na tela antes do redirecionamento. */
const EXIGENCIA = {
  'dashboard.html': 'respostas',
  'setores.html':   'respostas',
  'respostas.html': 'respostas',
  'usuarios.html':  'usuarios',
};

function temPermissao(papel, exigencia) {
  if (exigencia === 'respostas') return podeVerRespostas(papel);
  if (exigencia === 'usuarios') return podeAbrirUsuarios(papel);
  return false;
}

function permitido(rel) {
  if (rel.includes('..')) return false;
  const primeiro = rel.split('/')[0];
  if (BLOQUEADOS.includes(primeiro)) return false;
  if (primeiro.startsWith('.')) return false;
  return Object.hasOwn(TIPOS, path.extname(rel).toLowerCase());
}

function redirecionar(res, destino) {
  res.writeHead(302, { location: destino, 'cache-control': 'no-store' });
  res.end();
}

async function servirEstatico(req, res, urlPath, sessao) {
  let rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  if (!path.extname(rel)) rel += '.html';        // /pesquisa → /pesquisa.html

  if (!permitido(rel)) return responder(res, 404, 'text/plain; charset=utf-8', 'Não encontrado');

  const exigencia = EXIGENCIA[rel];
  if (exigencia) {
    if (!sessao) return redirecionar(res, '/login.html?de=' + encodeURIComponent('/' + rel));
    // Senha provisória: nada além da troca até resolver.
    if (sessao.provisoria) return redirecionar(res, '/login.html?trocar=1');
    // Papel sem permissão vai para a própria casa, não para um 403 seco.
    if (!temPermissao(sessao.papel, exigencia)) return redirecionar(res, paginaInicial(sessao.papel));
  }

  // Quem já está dentro não precisa ver o login outra vez.
  if (rel === 'login.html' && sessao && !sessao.provisoria) {
    return redirecionar(res, paginaInicial(sessao.papel));
  }

  const arquivo = path.join(RAIZ, rel);
  if (!arquivo.startsWith(RAIZ + path.sep)) {
    return responder(res, 403, 'text/plain; charset=utf-8', 'Proibido');
  }

  try {
    const dados = await fsp.readFile(arquivo);
    const ext = path.extname(arquivo).toLowerCase();
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, {
      'content-type': TIPOS[ext],
      'cache-control': cache,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
    });
    res.end(dados);
  } catch {
    responder(res, 404, 'text/plain; charset=utf-8', 'Não encontrado');
  }
}

/* ---------------- helpers ---------------- */

function responder(res, status, tipo, corpo, extras) {
  res.writeHead(status, { 'content-type': tipo, 'cache-control': 'no-store', ...(extras || {}) });
  res.end(corpo);
}

function json(res, status, dados, extras) {
  responder(res, status, 'application/json; charset=utf-8', JSON.stringify(dados), extras);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let bruto = '';
    let tamanho = 0;
    req.on('data', (pedaco) => {
      tamanho += pedaco.length;
      if (tamanho > LIMITE_CORPO) {
        reject(Object.assign(new Error('grande demais'), { status: 413 }));
        req.destroy();
        return;
      }
      bruto += pedaco;
    });
    req.on('end', () => resolve(bruto));
    req.on('error', reject);
  });
}

async function lerJson(req) {
  const bruto = await lerCorpo(req);
  const corpo = JSON.parse(bruto || '{}');
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new Error('formato');
  return corpo;
}

/** No Railway o TLS termina no roteador: a requisição chega em http. */
function ehSeguro(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https' || !!req.socket.encrypted;
}

function sessaoPublica(linha) {
  return {
    id: linha.id, email: linha.email, nome: linha.nome || '',
    papel: linha.papel, provisoria: !!linha.provisoria,
  };
}

/** Resolve a sessão do cookie e renova a validade na metade final. */
async function resolverSessao(req) {
  const token = lerCookies(req.headers.cookie)[NOME_COOKIE];
  if (!token) return null;
  let linha;
  try { linha = await contas.buscarSessao(hashToken(token)); }
  catch { return null; }
  if (!linha) return null;

  const restante = new Date(linha.expira_em).getTime() - Date.now();
  if (restante < (MAX_IDADE * 1000) / 2) {
    contas.renovarSessao(hashToken(token), new Date(Date.now() + MAX_IDADE * 1000))
      .catch(() => {});
  }
  return { ...sessaoPublica(linha), token };
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- /api/responses ---------------- */

async function apiRespostas(req, res, sessao) {
  /* Leitura é confidencial: exige sessão com permissão de respostas —
     ou seja, RH. TI administra contas e não lê entrevista de ninguém.
     Gravação é pública, senão a pesquisa não funcionaria. */
  if (req.method === 'GET') {
    if (!sessao) return json(res, 401, { erro: 'Não autenticado.' });
    if (sessao.provisoria) return json(res, 403, { erro: 'Troque a senha provisória antes de continuar.' });
    if (!podeVerRespostas(sessao.papel)) {
      return json(res, 403, { erro: 'Seu perfil não tem acesso às respostas da pesquisa.' });
    }
    if (!banco) return json(res, 503, { erro: 'Banco não configurado (DATABASE_URL ausente).' });
    try {
      return json(res, 200, await banco.listar());
    } catch (err) {
      console.error('[api] falha ao listar:', err.message);
      return json(res, 500, { erro: 'Falha ao ler as respostas.' });
    }
  }

  if (req.method === 'POST') {
    if (!banco) return json(res, 503, { erro: 'Banco não configurado (DATABASE_URL ausente).' });
    let corpo;
    try { corpo = await lerJson(req); }
    catch (err) {
      if (err.status === 413) return json(res, 413, { erro: 'Payload grande demais.' });
      return json(res, 400, { erro: 'JSON inválido.' });
    }

    let registro;
    try { registro = sanear(corpo); }
    catch { return json(res, 400, { erro: 'Resposta em formato inesperado.' }); }

    try {
      await banco.gravar(registro);
      return json(res, 201, { ok: true, id: registro.id });
    } catch (err) {
      console.error('[api] falha ao gravar:', err.message);
      return json(res, 500, { erro: 'Falha ao gravar a resposta.' });
    }
  }

  return json(res, 405, { erro: 'Método não permitido.' }, { allow: 'GET, POST' });
}

/* ---------------- autenticação ---------------- */

async function apiLogin(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Método não permitido.' }, { allow: 'POST' });

  const ip = ipDaRequisicao(req);

  /* Trava dura por IP, antes de qualquer trabalho: sem isso, cada tentativa
     custa um scrypt de ~80ms e vira também um jeito de derrubar o servidor. */
  const restante = limite.bloqueioRestante(ip);
  if (restante > 0) {
    return json(res, 429,
      { erro: `Tentativas demais. Tente de novo em ${formatarEspera(restante)}.` },
      { 'retry-after': String(Math.ceil(restante / 1000)) });
  }

  let corpo;
  try { corpo = await lerJson(req); }
  catch { return json(res, 400, { erro: 'JSON inválido.' }); }

  const email = normalizarEmail(corpo.email);
  const senha = String(corpo.senha == null ? '' : corpo.senha);

  const usuario = await contas.buscarPorEmail(email).catch(() => null);
  const confere = usuario ? await conferirSenha(senha, usuario.senha_hash) : false;

  if (!usuario || !confere) {
    /* Atraso crescente por conta — nunca bloqueio. Bloquear por e-mail
       entregaria um jeito trivial de trancar o RH de fora. */
    const atraso = limite.atrasoDaConta(email);
    limite.registrarFalha(ip, email);
    await dormir(atraso);
    // Mensagem única de propósito: dizer "este e-mail não existe"
    // entregaria quais endereços têm conta.
    return json(res, 401, { erro: 'E-mail ou senha incorretos.' });
  }

  limite.registrarAcerto(ip, email);
  const token = novoToken();
  await contas.criarSessao(usuario.id, hashToken(token), new Date(Date.now() + MAX_IDADE * 1000));
  contas.marcarAcesso(usuario.id).catch(() => {});

  return json(res, 200, {
    ok: true,
    usuario: sessaoPublica(usuario),
    destino: usuario.provisoria ? null : paginaInicial(usuario.papel),
  }, { 'set-cookie': cookieSessao(token, { seguro: ehSeguro(req), maxIdade: MAX_IDADE }) });
}

async function apiLogout(req, res, sessao) {
  if (sessao) await contas.apagarSessao(hashToken(sessao.token)).catch(() => {});
  return json(res, 200, { ok: true }, { 'set-cookie': cookieLimpo({ seguro: ehSeguro(req) }) });
}

function apiEu(res, sessao) {
  if (!sessao) return json(res, 401, { erro: 'Não autenticado.' });
  return json(res, 200, {
    usuario: {
      id: sessao.id, email: sessao.email, nome: sessao.nome,
      papel: sessao.papel, provisoria: sessao.provisoria,
    },
    inicio: paginaInicial(sessao.papel),
    podeVerRespostas: podeVerRespostas(sessao.papel),
    podeAdministrarContas: podeAdministrarContas(sessao.papel),
    demoPermitida: DEMO_PERMITIDA,
    temBanco: !!banco,
  });
}

/** Troca da própria senha. É por aqui que a provisória deixa de ser provisória. */
async function apiSenha(req, res, sessao) {
  if (!sessao) return json(res, 401, { erro: 'Não autenticado.' });
  if (req.method !== 'POST') return json(res, 405, { erro: 'Método não permitido.' }, { allow: 'POST' });

  let corpo;
  try { corpo = await lerJson(req); }
  catch { return json(res, 400, { erro: 'JSON inválido.' }); }

  const atual = String(corpo.atual == null ? '' : corpo.atual);
  const nova = String(corpo.nova == null ? '' : corpo.nova);

  const usuario = await contas.buscarPorId(sessao.id);
  if (!usuario) return json(res, 401, { erro: 'Sessão inválida.' });

  if (!await conferirSenha(atual, usuario.senha_hash)) {
    // Já autenticado aqui, então basta o atraso fixo: não é porta de entrada.
    await dormir(600);
    return json(res, 400, { erro: 'A senha atual está incorreta.' });
  }
  if (nova === atual) return json(res, 400, { erro: 'A nova senha tem de ser diferente da atual.' });

  const critica = criticarSenha(nova, usuario.email);
  if (critica) return json(res, 400, { erro: critica });

  await contas.definirSenha(usuario.id, await gerarHash(nova), false);

  /* Derruba as outras sessões e emite um cookie novo: se a senha foi
     trocada porque vazou, quem estava dentro sai junto. */
  await contas.apagarSessoesDoUsuario(usuario.id).catch(() => {});
  const token = novoToken();
  await contas.criarSessao(usuario.id, hashToken(token), new Date(Date.now() + MAX_IDADE * 1000));

  return json(res, 200, { ok: true, destino: paginaInicial(usuario.papel) },
    { 'set-cookie': cookieSessao(token, { seguro: ehSeguro(req), maxIdade: MAX_IDADE }) });
}

/* ---------------- /api/usuarios ---------------- */

async function apiUsuarios(req, res, sessao, url) {
  if (!sessao) return json(res, 401, { erro: 'Não autenticado.' });
  if (sessao.provisoria) return json(res, 403, { erro: 'Troque a senha provisória antes de continuar.' });
  if (!podeAbrirUsuarios(sessao.papel)) return json(res, 403, { erro: 'Sem permissão.' });

  const resto = url.pathname.replace(/^\/api\/usuarios\/?/, '');
  const partes = resto ? resto.split('/') : [];
  const admin = podeAdministrarContas(sessao.papel);

  /* ---- lista ---- */
  if (req.method === 'GET' && !partes.length) {
    const lista = await contas.listar();
    // RH não precisa enxergar as contas de TI.
    const visivel = admin ? lista : lista.filter((u) => u.papel === 'rh');
    return json(res, 200, {
      usuarios: visivel,
      eu: sessao.id,
      papel: sessao.papel,
      podeAdministrar: admin,
      papeisQuePodeCriar: PAPEIS.filter((p) => podeCriarPapel(sessao.papel, p)),
    });
  }

  /* ---- incluir ---- */
  if (req.method === 'POST' && !partes.length) {
    let corpo;
    try { corpo = await lerJson(req); }
    catch { return json(res, 400, { erro: 'JSON inválido.' }); }

    const email = normalizarEmail(corpo.email);
    const papel = String(corpo.papel || 'rh');
    const nome = String(corpo.nome || '').slice(0, 120);
    const senha = String(corpo.senha == null ? '' : corpo.senha);

    if (!emailValido(email)) return json(res, 400, { erro: 'E-mail inválido.' });
    if (!PAPEIS.includes(papel)) return json(res, 400, { erro: 'Perfil desconhecido.' });
    if (!podeCriarPapel(sessao.papel, papel)) {
      return json(res, 403, { erro: 'Seu perfil só pode incluir contas de RH.' });
    }
    const critica = criticarSenha(senha, email);
    if (critica) return json(res, 400, { erro: critica });
    if (await contas.buscarPorEmail(email)) {
      return json(res, 409, { erro: 'Já existe uma conta com este e-mail.' });
    }

    const novo = await contas.criar({
      email, nome, papel,
      senhaHash: await gerarHash(senha),
      provisoria: true,                 // quem entrar troca no primeiro acesso
      criadoPor: sessao.email,
    });
    return json(res, 201, { ok: true, usuario: novo });
  }

  /* ---- redefinir senha de outra pessoa (só TI) ---- */
  if (req.method === 'POST' && partes.length === 2 && partes[1] === 'senha') {
    if (!admin) return json(res, 403, { erro: 'Só o TI redefine a senha de outra conta.' });

    let corpo;
    try { corpo = await lerJson(req); }
    catch { return json(res, 400, { erro: 'JSON inválido.' }); }

    const alvo = await contas.buscarPorId(partes[0]);
    if (!alvo) return json(res, 404, { erro: 'Conta não encontrada.' });

    const nova = String(corpo.senha == null ? '' : corpo.senha);
    const critica = criticarSenha(nova, alvo.email);
    if (critica) return json(res, 400, { erro: critica });

    await contas.definirSenha(alvo.id, await gerarHash(nova), true);
    await contas.apagarSessoesDoUsuario(alvo.id).catch(() => {});
    return json(res, 200, { ok: true, email: alvo.email });
  }

  /* ---- excluir (só TI) ---- */
  if (req.method === 'DELETE' && partes.length === 1) {
    if (!admin) return json(res, 403, { erro: 'Só o TI exclui contas.' });

    const alvo = await contas.buscarPorId(partes[0]);
    if (!alvo) return json(res, 404, { erro: 'Conta não encontrada.' });
    if (alvo.id === sessao.id) return json(res, 400, { erro: 'Você não pode excluir a própria conta.' });

    /* Sem estas guardas dá para trancar todo mundo fora: sem TI ninguém
       administra contas, e sem RH ninguém lê a pesquisa. */
    if (alvo.papel === 'ti' && await contas.contarPorPapel('ti') <= 1) {
      return json(res, 400, { erro: 'É a única conta de TI. Inclua outra antes de excluir esta.' });
    }
    if (alvo.papel === 'rh' && await contas.contarPorPapel('rh') <= 1) {
      return json(res, 400, { erro: 'É a única conta de RH — ninguém mais leria a pesquisa. Inclua outra antes de excluir esta.' });
    }

    await contas.apagar(alvo.id);
    return json(res, 200, { ok: true, email: alvo.email });
  }

  return json(res, 405, { erro: 'Método não permitido.' }, { allow: 'GET, POST, DELETE' });
}

/* ---------------- healthcheck ---------------- */

/* Healthcheck do Railway. Rota pública, então devolve o mínimo: se o processo
   está de pé e se o banco responde. A contagem de respostas ficava aqui antes,
   mas é informação interna — quantas pessoas saíram da empresa não precisa
   estar num endpoint aberto. */
async function saude(res) {
  if (!banco) return json(res, 200, { ok: true, banco: false, modo: 'memoria' });
  try {
    await banco.saude();
    return json(res, 200, { ok: true, banco: true });
  } catch (err) {
    console.error('[saude] banco não respondeu:', err.message);
    return json(res, 503, { ok: false, banco: false });
  }
}

/* ---------------- servidor ---------------- */

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const rota = url.pathname;

  try {
    // Login e healthcheck não dependem de sessão.
    if (rota === '/api/login') return await apiLogin(req, res);
    if (rota === '/api/saude') return await saude(res);

    const sessao = await resolverSessao(req);

    if (rota === '/api/logout')    return await apiLogout(req, res, sessao);
    if (rota === '/api/eu')        return apiEu(res, sessao);
    if (rota === '/api/senha')     return await apiSenha(req, res, sessao);
    if (rota === '/api/responses') return await apiRespostas(req, res, sessao);
    if (rota === '/api/usuarios' || rota.startsWith('/api/usuarios/')) {
      return await apiUsuarios(req, res, sessao, url);
    }
    if (rota.startsWith('/api/')) return json(res, 404, { erro: 'Rota inexistente.' });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return responder(res, 405, 'text/plain; charset=utf-8', 'Método não permitido');
    }
    return await servirEstatico(req, res, rota, sessao);
  } catch (err) {
    console.error('[server] erro não tratado:', err);
    if (!res.headersSent) json(res, 500, { erro: 'Erro interno.' });
  }
});

servidor.listen(PORTA, () => {
  console.log(`[server] no ar em http://0.0.0.0:${PORTA}`);
  console.log(`[server] respostas: ${banco ? 'Postgres' : 'nenhum (modo local no navegador)'}`);
  if (banco) banco.preparar().catch((e) => console.error('[db] falha ao preparar:', e.message));
  contas.preparar().catch((e) => console.error('[auth] falha ao preparar:', e.message));
});

/* Faxina de sessões vencidas e do histórico de tentativas: pouco depois do
   boot e de hora em hora. */
const faxina = setInterval(() => {
  contas.limparExpiradas()
    .then((n) => { if (n) console.log(`[auth] ${n} sessão(ões) vencida(s) removida(s)`); })
    .catch(() => {});
  limite.podar();
}, 3600_000);
faxina.unref();
setTimeout(() => contas.limparExpiradas().catch(() => {}), 5000).unref();

/* Railway manda SIGTERM no redeploy; fecha limpo. */
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    console.log(`[server] ${sinal} recebido, encerrando`);
    servidor.close(() => {
      if (banco) banco.fechar().finally(() => process.exit(0));
      else process.exit(0);
    });
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
