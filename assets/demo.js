/* =========================================================
   demo.js — conjunto de exemplo, para ver o painel funcionando
   antes de existir resposta real.

   Não é aleatório de verdade: usa um gerador com semente fixa, então
   o mesmo conjunto sai igual em qualquer navegador — e cada setor tem
   um perfil próprio, senão a tela "por setor" não teria nada a mostrar.
   ========================================================= */

window.Demo = (function () {
  /* ---------------- aleatório com semente (mulberry32) ---------------- */
  function rng(semente) {
    let a = semente >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Semente escolhida entre várias para dar cobertura decente aos 12 setores
     em 160 registros — a menor base fica em 6 respostas, em vez das 2 que
     algumas sementes produziam. O sorteio em si é proporcional aos pesos
     (verificado com 4000 registros, desvio máximo de 6%). */
  const r = rng(20260820);
  const escolhe = (arr) => arr[Math.floor(r() * arr.length)];
  const entre = (a, b) => a + Math.floor(r() * (b - a + 1));

  /** Nota 1–5 sorteada em volta de uma média, presa na faixa. */
  function nota(centro) {
    const bruto = centro + (r() + r() + r() - 1.5) * 1.5;
    return Math.max(1, Math.min(5, Math.round(bruto)));
  }

  /* ---------------- perfis por setor ----------------
     `base` desloca todas as dimensões; `ajuste` mexe em pontos
     específicos. É o que faz a comparação entre setores ter sentido. */
  const PERFIS = [
    { setor: 'Produção', peso: 22, base: -0.5, npsBase: 6,
      ajuste: { scale_estrutura: -1.1, scale_salario: -0.9, scale_equilibrio: -0.6, scale_reconhecimento: -0.7 },
      desafios: ['Remuneração', 'Carga de trabalho', 'Liderança e gestão'] },
    { setor: 'Comercial / Vendas', peso: 15, base: -0.2, npsBase: 7,
      ajuste: { scale_equilibrio: -1.2, scale_salario: -0.4, scale_organizacao: -0.5 },
      desafios: ['Carga de trabalho', 'Remuneração', 'Alinhamento entre expectativas e a função'] },
    { setor: 'Expedição', peso: 12, base: -0.4, npsBase: 6,
      ajuste: { scale_estrutura: -0.8, scale_equilibrio: -0.6, scale_crescimento: -0.7 },
      desafios: ['Carga de trabalho', 'Remuneração', 'Clima e cultura'] },
    { setor: 'Tecnologia da Informação', peso: 12, base: 0.5, npsBase: 8,
      ajuste: { scale_reconhecimento: -0.5, scale_crescimento: 0.4, scale_estrutura: 0.5 },
      desafios: ['Oportunidades de crescimento', 'Remuneração', 'Comunicação e feedback'] },
    { setor: 'Assistência Técnica', peso: 11, base: -0.3, npsBase: 6,
      ajuste: { scale_equilibrio: -0.9, scale_organizacao: -0.6, scale_reconhecimento: -0.5 },
      desafios: ['Carga de trabalho', 'Liderança e gestão', 'Comunicação e feedback'] },
    { setor: 'Logística', peso: 9, base: -0.3, npsBase: 7,
      ajuste: { scale_estrutura: -0.7, scale_equilibrio: -0.5 },
      desafios: ['Carga de trabalho', 'Remuneração', 'Clima e cultura'] },
    { setor: 'Facilities', peso: 7, base: -0.4, npsBase: 6,
      ajuste: { scale_crescimento: -1.0, scale_salario: -0.7, scale_reconhecimento: -0.6 },
      desafios: ['Oportunidades de crescimento', 'Remuneração', 'Clima e cultura'] },
    { setor: 'Financeiro', peso: 6, base: 0.4, npsBase: 7,
      ajuste: { scale_organizacao: 0.4, scale_crescimento: -0.4 },
      desafios: ['Oportunidades de crescimento', 'Carga de trabalho'] },
    { setor: 'Compras', peso: 6, base: 0.2, npsBase: 7,
      ajuste: { scale_crescimento: -0.5, scale_comunicacao: -0.4 },
      desafios: ['Oportunidades de crescimento', 'Comunicação e feedback'] },
    { setor: 'Processos', peso: 5, base: 0.3, npsBase: 7,
      ajuste: { scale_comunicacao: -0.6, scale_organizacao: 0.3 },
      desafios: ['Comunicação e feedback', 'Alinhamento entre expectativas e a função'] },
    { setor: 'Marketing', peso: 5, base: 0.3, npsBase: 7,
      ajuste: { scale_organizacao: -0.6, scale_reconhecimento: 0.3 },
      desafios: ['Comunicação e feedback', 'Alinhamento entre expectativas e a função'] },
    { setor: 'RH', peso: 5, base: 0.6, npsBase: 8,
      ajuste: { scale_salario: -0.5 },
      desafios: ['Remuneração', 'Alinhamento entre expectativas e a função'] },
  ];

  const CARGOS = {
    'Produção': ['Operador de produção', 'Auxiliar de produção', 'Líder de turno', 'Encarregado de produção'],
    'Comercial / Vendas': ['Consultor de vendas', 'Executivo de contas', 'Vendedor interno', 'Coordenador comercial'],
    'Expedição': ['Auxiliar de expedição', 'Conferente', 'Separador', 'Encarregado de expedição'],
    'Tecnologia da Informação': ['Analista de sistemas', 'Desenvolvedor', 'Analista de suporte N2', 'Analista de dados'],
    'Assistência Técnica': ['Técnico de campo', 'Técnico de manutenção', 'Analista de suporte técnico', 'Supervisor técnico'],
    'Logística': ['Auxiliar de logística', 'Conferente', 'Analista de logística', 'Motorista'],
    'Facilities': ['Auxiliar de manutenção', 'Técnico de manutenção predial', 'Auxiliar de serviços gerais'],
    'Financeiro': ['Analista financeiro', 'Assistente de contas a pagar', 'Analista de cobrança'],
    'Compras': ['Analista de compras', 'Comprador', 'Assistente de compras'],
    'Processos': ['Analista de processos', 'Analista de melhoria contínua', 'Coordenador de processos'],
    'Marketing': ['Analista de marketing', 'Designer', 'Analista de mídias'],
    'RH': ['Analista de RH', 'Assistente de DP', 'Business partner'],
  };

  const NOMES = [
    'Ana Beatriz Souza', 'Carlos Eduardo Lima', 'Fernanda Rocha', 'Gustavo Almeida',
    'Juliana Martins', 'Rafael Nogueira', 'Patrícia Gomes', 'Thiago Barbosa',
    'Camila Ferreira', 'Bruno Cardoso', 'Larissa Pinto', 'Marcelo Ribeiro',
    'Vanessa Duarte', 'Diego Moreira', 'Aline Castro', 'Rodrigo Teixeira',
    'Priscila Andrade', 'Felipe Cavalcanti', 'Débora Nunes', 'Leandro Vieira',
    'Renata Carvalho', 'Vinícius Prado', 'Tatiane Freitas', 'André Bezerra',
    'Simone Batista', 'Eduardo Farias', 'Michele Aguiar', 'Paulo Henrique Dias',
    'Cristiane Lopes', 'Igor Sampaio', 'Natália Correia', 'Wesley Monteiro',
  ];

  const SUPERIORES = [
    'Marcos Antunes', 'Cláudia Reis', 'Sérgio Palmeira', 'Helena Braga',
    'Roberto Kanashiro', 'Lúcia Mendonça', 'Fábio Estrela', 'Adriana Queiroz',
  ];

  /* ---------------- textos por tema ---------------- */

  const T_LIDERANCA = [
    'Faltava clareza no que era esperado de mim. As prioridades mudavam toda semana e ninguém assumia a decisão.',
    'Cobrança sem apoio. Quando o resultado vinha, era do time; quando não vinha, era só meu.',
    'Nunca tive um feedback estruturado em dois anos. Só ouvia sobre o que estava errado, em público.',
    'A liderança não conhecia a rotina da operação e tomava decisões que não paravam de pé no dia a dia.',
    'Meu gestor era técnico excelente, mas não tinha preparo para conduzir gente. Faltou treinamento para ele também.',
    'Promessas de plano de carreira que nunca saíram do papel. Depois da terceira vez, deixei de acreditar.',
    'Reuniões demais e decisão de menos. Levava semanas para aprovar algo simples.',
    'Tratamento diferente entre as pessoas da mesma equipe, e isso ficava evidente na distribuição de tarefas.',
  ];

  const T_VOLTARIA_SIM = [
    'Voltaria sim. Aprendi muito e o time era excelente. O que me tirou daqui foi salário, não o ambiente.',
    'Voltaria, principalmente se fosse em outra área. A empresa tem uma base boa, falta ajustar a gestão.',
    'Sim, sem dúvida. Saio bem, apenas recebi uma proposta que não daria para recusar.',
    'Voltaria se houvesse plano de carreira definido. Gostava do trabalho e das pessoas.',
    'Sim. A empresa me deu a primeira oportunidade e sou grata por isso.',
  ];

  const T_VOLTARIA_NAO = [
    'Hoje não voltaria. O desgaste com a chefia direta foi grande e não vi movimento para mudar.',
    'Não voltaria para a mesma área. Talvez em outro setor, com outra liderança.',
    'Não. Saio esgotado, com carga de trabalho que não cabia em uma pessoa só.',
    'Difícil dizer que sim. Faltou reconhecimento no básico: dizer obrigado quando o time virava a noite.',
    'Não voltaria. Cheguei a pedir ajuda várias vezes e a resposta era sempre "aguenta um pouco".',
  ];

  const T_TRES = [
    '1) Definir plano de carreira de verdade. 2) Treinar as lideranças. 3) Revisar a tabela salarial pelo mercado.',
    '1) Reduzir o número de reuniões. 2) Dar autonomia para quem está na ponta. 3) Melhorar a comunicação de mudanças.',
    '1) Investir na estrutura física, principalmente refeitório e vestiário. 2) Escala mais previsível. 3) Feedback mensal.',
    '1) Contratar mais gente para a equipe. 2) Rever metas irreais. 3) Ouvir a operação antes de decidir.',
    '1) Transparência sobre resultados da empresa. 2) Programa de reconhecimento. 3) Flexibilidade de horário.',
    '1) Onboarding decente — passei duas semanas sem saber o que fazer. 2) Documentar processos. 3) Rever a política de home office.',
    '1) Salário compatível com o mercado. 2) Menos rotatividade na liderança. 3) Investir em treinamento técnico.',
  ];

  const T_EVITAR = [
    'Sim: um ajuste salarial na época da promoção. Eu tinha avisado que estava defasado e nada aconteceu.',
    'Poderia, se tivessem me ouvido quando pedi mudança de equipe. Insisti três vezes.',
    'Talvez. Se tivesse plano de crescimento claro, eu teria esperado mais.',
    'Não. A decisão foi pessoal, de mudança de cidade.',
    'Sim. Bastaria dividir a carga de trabalho — eu acumulei duas funções por sete meses.',
    'Uma conversa honesta sobre carreira, feita seis meses antes, teria mudado tudo.',
    'Não creio. Recebi uma oportunidade em outra área, e aqui não existia esse caminho.',
  ];

  const T_COMENTARIOS = [
    'Agradeço a oportunidade. Espero que a pesquisa seja usada de verdade e não só arquivada.',
    'Sugiro fazer essa conversa antes da pessoa pedir demissão, não depois.',
    'O time da minha área é o melhor que já trabalhei. O problema nunca foi ele.',
    'Deixo meu contato à disposição, caso queiram detalhar qualquer ponto.',
    'Só reforço: escutem o pessoal da operação. Muita coisa se resolveria ali.',
    '',
    '',
  ];

  /* ---------------- geração ---------------- */

  function sorteiaSetor() {
    const total = PERFIS.reduce((a, p) => a + p.peso, 0);
    let x = r() * total;
    for (const p of PERFIS) { x -= p.peso; if (x <= 0) return p; }
    return PERFIS[0];
  }

  function gerarRegistros(quantos) {
    const DIMS = window.APP.DIMENSOES.map((d) => d.id);
    const registros = [];
    const agora = Date.now();
    const JANELA = 420 * 86400000;         // ~14 meses

    for (let i = 0; i < quantos; i++) {
      const perfil = sorteiaSetor();

      // Curva de volume: mais respostas nos meses recentes.
      const t = Math.pow(r(), 0.62);
      const quando = new Date(agora - JANELA + t * JANELA - entre(0, 20) * 3600000);

      const centro = 3.35 + perfil.base;
      const reg = {
        timestamp: quando.toISOString(),
        // ~1 em 5 responde de forma anônima — o formulário permite.
        nome: r() < 0.8 ? escolhe(NOMES) : '',
        cargo: escolhe(CARGOS[perfil.setor] || ['Analista']),
        departamento: perfil.setor,
        superior: r() < 0.85 ? escolhe(SUPERIORES) : '',
      };

      DIMS.forEach((id) => {
        // ~7% deixam a escala em branco (nenhuma é obrigatória).
        if (r() < 0.07) { reg[id] = null; return; }
        reg[id] = nota(centro + (perfil.ajuste[id] || 0));
      });

      const mediaPessoa = window.Stats.media(DIMS.map((id) => reg[id])) || centro;
      const npsBruto = perfil.npsBase + (mediaPessoa - 3.2) * 2.0 + (r() - 0.5) * 3;
      reg.nps = r() < 0.05 ? null : Math.max(0, Math.min(10, Math.round(npsBruto)));

      // Desafios: os do perfil entram com mais chance que os demais.
      const desafios = new Set();
      perfil.desafios.forEach((d, k) => { if (r() < 0.72 - k * 0.16) desafios.add(d); });
      window.APP.ASPECTOS.forEach((a) => { if (r() < 0.11) desafios.add(a); });
      if (!desafios.size) desafios.add(escolhe(perfil.desafios));
      reg.aspectos = Array.from(desafios);

      if (reg.aspectos.includes('Liderança e gestão') && r() < 0.82) {
        reg.lideranca_detalhe = escolhe(T_LIDERANCA);
      }

      const positivo = (reg.nps == null ? mediaPessoa > 3.2 : reg.nps >= 7);
      if (r() < 0.86) reg.voltaria = escolhe(positivo ? T_VOLTARIA_SIM : T_VOLTARIA_NAO);
      if (r() < 0.72) reg.tres_pontos = escolhe(T_TRES);
      if (r() < 0.78) reg.evitar = escolhe(T_EVITAR);
      if (r() < 0.52) reg.comentarios = escolhe(T_COMENTARIOS);

      registros.push(reg);
    }

    return registros.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Grava o conjunto de exemplo.
   * • modo local → substitui o conteúdo do localStorage
   * • modo api   → grava no armazenamento compartilhado (pede confirmação,
   *                porque aí os dados ficam visíveis para todo mundo)
   */
  async function gerar(quantos) {
    const registros = gerarRegistros(quantos || 140);

    if (window.Store.mode() === 'api') {
      const ok = confirm(
        'O site está conectado ao armazenamento compartilhado.\n\n'
        + registros.length + ' respostas de exemplo serão gravadas lá e ficarão '
        + 'visíveis para todos os acessos. Continuar?');
      if (!ok) return false;
      await window.Store.addMany(registros);
      return true;
    }

    window.Store.seedLocal(registros);
    return true;
  }

  return { gerar, gerarRegistros };
})();
