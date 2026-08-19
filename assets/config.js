/* =========================================================
   config.js — tudo que se ajusta sem mexer no resto do código.
   ========================================================= */

window.APP = (function () {
  /* ---------- Identidade ---------- */
  const EMPRESA = 'Azime';

  /* ---------- Setores / departamentos ----------
     Vira lista fechada (em vez de texto livre) porque o dashboard
     "detalhe por setor" só agrupa de forma confiável com valores
     canônicos. Editar aqui reflete no formulário e nos relatórios. */
  /* Em ordem alfabética, com "Outro" no fim: numa lista de 13 opções,
     achar o próprio setor é mais rápido assim do que numa ordem livre. */
  const SETORES = [
    'Assistência Técnica',
    'Comercial / Vendas',
    'Compras',
    'Expedição',
    'Facilities',
    'Financeiro',
    'Logística',
    'Marketing',
    'Processos',
    'Produção',
    'RH',
    'Tecnologia da Informação',
    'Outro',
  ];

  /* O acesso à área de gestão é por e-mail e senha, verificado no
     servidor — não há nada de credencial neste arquivo. As contas
     iniciais e a duração da sessão ficam em variáveis de ambiente
     (ver .env.example). */

  /* ---------- Dimensões da avaliação 1–5 ----------
     `id` casa com o campo salvo; `curto` é o rótulo dos gráficos. */
  const DIMENSOES = [
    { id: 'scale_estrutura',      curto: 'Estrutura física',        longo: 'Estrutura física para trabalhar' },
    { id: 'scale_equipe',         curto: 'Relação com a equipe',    longo: 'Relacionamento com a equipe' },
    { id: 'scale_organizacao',    curto: 'Organização do trabalho', longo: 'Organização e planejamento do trabalho' },
    { id: 'scale_chefia',         curto: 'Relação com a chefia',    longo: 'Relacionamento com a chefia' },
    { id: 'scale_crescimento',    curto: 'Crescimento',             longo: 'Oportunidades de crescimento e desenvolvimento profissional' },
    { id: 'scale_salario',        curto: 'Salário e benefícios',    longo: 'Salário e benefícios condizentes com o cargo' },
    { id: 'scale_reconhecimento', curto: 'Reconhecimento',          longo: 'Reconhecimento pelo seu trabalho e resultados' },
    { id: 'scale_comunicacao',    curto: 'Comunicação e feedback',  longo: 'Comunicação da liderança sobre expectativas e feedback' },
    { id: 'scale_equilibrio',     curto: 'Equilíbrio vida-trabalho', longo: 'Equilíbrio entre vida pessoal e profissional' },
    { id: 'scale_onboarding',     curto: 'Onboarding',              longo: 'Qualidade do processo de integração (onboarding) quando você entrou' },
  ];

  /* ---------- Opções de desafios (múltipla escolha) ---------- */
  const ASPECTOS = [
    'Remuneração',
    'Liderança e gestão',
    'Oportunidades de crescimento',
    'Clima e cultura',
    'Carga de trabalho',
    'Alinhamento entre expectativas e a função',
    'Comunicação e feedback',
    'Outro',
  ];

  /* ---------- Perguntas abertas (para a aba de comentários) ---------- */
  const ABERTAS = [
    { id: 'lideranca_detalhe', titulo: 'O que não funcionou na liderança' },
    { id: 'voltaria',          titulo: 'Trabalharia aqui novamente?' },
    { id: 'tres_pontos',       titulo: '3 pontos que mudaria' },
    { id: 'evitar',            titulo: 'O que evitaria a saída' },
    { id: 'comentarios',       titulo: 'Comentários livres' },
  ];

  /* ---------- Rótulos de todos os campos (usado no Excel e no detalhe) ---------- */
  const CAMPOS = [
    { id: 'timestamp',         titulo: 'Data/hora' },
    { id: 'nome',              titulo: 'Nome' },
    { id: 'cargo',             titulo: 'Cargo' },
    { id: 'departamento',      titulo: 'Setor' },
    { id: 'superior',          titulo: 'Superior direto' },
    { id: 'aspectos',          titulo: 'Maiores desafios' },
    { id: 'lideranca_detalhe', titulo: 'Detalhe sobre liderança' },
    { id: 'voltaria',          titulo: 'Trabalharia aqui novamente?' },
    { id: 'tres_pontos',       titulo: '3 pontos que mudaria' },
    ...DIMENSOES.map((d) => ({ id: d.id, titulo: d.curto })),
    { id: 'nps',               titulo: 'NPS (0–10)' },
    { id: 'evitar',            titulo: 'O que evitaria a saída' },
    { id: 'comentarios',       titulo: 'Comentários livres' },
  ];

  /* ---------- Modelo do questionário ----------
     Mesma sequência do formulário original; `departamento` passou a ser
     escolha única e ganhou um passo condicional para "Outro". */
  const STEPS = [
    { id: 'intro', type: 'intro' },

    {
      id: 'nome', block: 'Identificação', type: 'text', required: false,
      title: 'Antes de começar',
      sub: 'Estes dados são opcionais — pode responder de forma anônima se preferir.',
      label: 'Nome',
    },
    {
      id: 'cargo', block: 'Identificação', type: 'text', required: false,
      title: 'Identificação', label: 'Cargo',
    },
    {
      id: 'departamento', block: 'Identificação', type: 'choice', multi: false, required: true,
      title: 'Identificação',
      sub: 'Em qual setor você trabalhava?',
      options: SETORES,
    },
    {
      id: 'departamento_outro', block: 'Identificação', type: 'text', required: false,
      title: 'Identificação', sub: 'Você marcou "Outro".', label: 'Qual setor?',
      condition: (a) => one(a.departamento) === 'Outro',
    },
    {
      id: 'superior', block: 'Identificação', type: 'text', required: false,
      title: 'Identificação', label: 'Superior direto',
    },

    {
      id: 'aspectos', block: 'Experiência', type: 'choice', multi: true, required: true,
      title: 'Sobre sua experiência',
      sub: 'Quais destes aspectos representaram maiores desafios no seu dia a dia na empresa?',
      options: ASPECTOS,
    },
    {
      id: 'lideranca_detalhe', block: 'Experiência', type: 'textarea', required: false,
      title: 'Sobre a liderança',
      sub: 'Você marcou "Liderança e gestão" — o que especificamente não funcionou?',
      label: 'Sua resposta',
      condition: (a) => Array.isArray(a.aspectos) && a.aspectos.includes('Liderança e gestão'),
    },

    {
      id: 'voltaria', block: 'Reflexão', type: 'textarea', required: false,
      title: 'Um olhar para trás',
      sub: 'Você trabalharia na empresa novamente? Por quê?',
      label: 'Sua resposta',
    },
    {
      id: 'tres_pontos', block: 'Reflexão', type: 'textarea', required: false,
      title: 'Se você fosse o dono',
      sub: 'Quais os 3 principais pontos que você mudaria se fosse o "dono da empresa"?',
      label: 'Sua resposta',
    },

    ...DIMENSOES.map((d) => ({
      id: d.id, block: 'Avaliação', type: 'scale5', required: false,
      title: 'Avaliação geral', sub: d.longo, label: d.curto,
    })),

    {
      id: 'nps', block: 'Recomendação', type: 'scale10', required: false,
      title: 'Uma última avaliação',
      sub: 'De 0 a 10, o quanto você recomendaria esta empresa como um bom lugar para trabalhar?',
    },

    {
      id: 'evitar', block: 'Fechamento', type: 'textarea', required: false,
      title: 'Para fechar',
      sub: 'Existe algo que a empresa poderia ter feito para evitar sua saída?',
      label: 'Sua resposta',
    },
    {
      id: 'comentarios', block: 'Fechamento', type: 'textarea', required: false,
      title: 'Espaço livre',
      sub: 'Outros comentários que queira registrar.',
      label: 'Sua resposta',
    },

    { id: 'final', type: 'final' },
  ];

  function one(v) { return Array.isArray(v) ? v[0] : v; }

  return { EMPRESA, SETORES, DIMENSOES, ASPECTOS, ABERTAS, CAMPOS, STEPS };
})();
