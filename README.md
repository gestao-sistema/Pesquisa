# Pesquisa de Desligamento · Azime

Formulário de entrevista de desligamento com área de gestão: dashboard, detalhe por
setor e a lista completa de respostas com exportação para Excel.

Servidor Node sem framework, front-end em HTML/CSS/JS sem build e sem bibliotecas.
A única dependência do projeto é o driver do Postgres. Os gráficos são SVG escritos à
mão e o `.xlsx` é gerado no próprio navegador.

## As telas

| Arquivo | O que é |
|---|---|
| [index.html](index.html) | Página inicial. Apresenta a pesquisa, explica o que será perguntado e como as respostas são tratadas. |
| [pesquisa.html](pesquisa.html) | O formulário. Uma pergunta por tela, ~5 minutos, identificação opcional. |
| [login.html](login.html) | Entrada da área de gestão: e-mail e senha, mais a troca obrigatória da senha provisória. |
| [dashboard.html](dashboard.html) | Panorama: eNPS, médias, distribuição das notas, desafios, volume no tempo e mapa de calor setor × dimensão. |
| [setores.html](setores.html) | Detalhe de um setor: o que ele tem de diferente da média da empresa, dimensão por dimensão, mais os comentários na íntegra. |
| [respostas.html](respostas.html) | Todas as respostas em tabela, com busca e filtros, detalhe por pessoa e exportação em `.xlsx` ou `.csv`. |
| [usuarios.html](usuarios.html) | Contas com acesso: incluir, excluir e redefinir senha, conforme o perfil. |

As telas de gestão exigem login e compartilham a mesma barra de filtros (setor e
período). Todo gráfico tem um botão **Tabela** com os mesmos números em formato
acessível, e responde a hover e a foco de teclado.

## Publicando no Railway

1. Suba a pasta para um repositório Git e crie um projeto no Railway a partir dele.
2. No projeto, **+ New → Database → PostgreSQL**. O Railway injeta a variável
   `DATABASE_URL` no serviço do site automaticamente.
3. Pronto. O [railway.json](railway.json) já define o start (`npm start`) e o
   healthcheck (`/api/saude`), e o [package.json](package.json) declara o driver.

Não existe passo de migração: a tabela é criada no boot com `CREATE TABLE IF NOT
EXISTS`. O primeiro deploy já sobe com o schema pronto.

**Nenhuma outra variável é obrigatória.** `PORT` também vem do Railway. Mas vale definir
`SENHA_INICIAL`, para a senha de partida não ficar registrada no repositório.

### Conferindo depois do deploy

| Verificação | Esperado |
|---|---|
| `/api/saude` | `{"ok":true,"banco":true}` — se vier `banco:false`, o `DATABASE_URL` não chegou |
| Log do boot | `dados de exemplo: bloqueados (banco de produção)` |
| Entrar, trocar a senha, **sair e entrar de novo** | funciona — prova que a conta persistiu na tabela, não em memória |
| Responder a pesquisa pelo celular | a linha aparece em Respostas |
| A faixa amarela "Modo local" | **não** deve aparecer |

### Rodando na sua máquina

```sh
npm install
npm start          # http://localhost:3000
```

Sem `DATABASE_URL` o servidor sobe assim mesmo, o `/api/responses` responde 503 e o
site cai para o **modo local** — as respostas ficam no `localStorage` do navegador.
Uma faixa amarela avisa quando é o caso. Serve para mexer no visual sem instalar banco.
Com a base vazia, o dashboard oferece **Carregar dados de exemplo**: 160 respostas
fictícias, com perfil diferente por setor, para ver o painel funcionando de ponta a
ponta. Esse botão **desaparece quando há Postgres ligado**, para não sujar a base real —
o log do boot diz qual é o estado (`[server] dados de exemplo: ...`). Para liberá-lo num
ambiente de teste com banco próprio, defina `PERMITIR_DEMO=true`.

Para rodar com banco de verdade localmente, copie [.env.example](.env.example) para
`.env` e aponte a `DATABASE_URL` (o Node 20+ lê `.env` com `node --env-file=.env server.js`).

## Acesso à área de gestão

Login por **e-mail e senha**, verificado no servidor. Duas contas são criadas no
primeiro boot, ambas com senha provisória:

| Conta | Senha inicial | O que faz |
|---|---|---|
| `RH@azime.com.br` | `AZIME2026` | Vê dashboard, setores e respostas. Pode incluir outras contas de RH. |
| `TI@azime.com.br` | `AZIME2026` | Administra contas: incluir, excluir, redefinir senha. **Não acessa as respostas.** |

No primeiro acesso de cada uma, o sistema **obriga a trocar a senha** antes de liberar
qualquer tela. Enquanto a senha for provisória, nem a API de respostas nem a de contas
respondem.

### A divisão de responsabilidades é intencional

| Ação | RH | TI |
|---|---|---|
| Ver dashboard, setores e respostas | sim | **não** |
| Exportar para Excel | sim | **não** |
| Incluir conta de RH | sim | sim |
| Incluir conta de TI | não | sim |
| Redefinir senha de outra conta | não | sim |
| Excluir conta | não | sim |

Quem administra o acesso não lê a entrevista de quem saiu, e quem lê a entrevista não
distribui acesso a quem quiser. Um TI que abrir `/dashboard.html` é devolvido para
`/usuarios.html`, e `GET /api/responses` responde 403 para ele.

### Como funciona por dentro

- Senha guardada com **scrypt** e sal próprio por conta — nunca em texto nem em cifra
  reversível. Sem dependência: vem do `node:crypto`.
- Sessão em cookie **HttpOnly, SameSite=Lax** e `Secure` quando a requisição chega por
  https (o Railway avisa pelo `x-forwarded-proto`). No banco fica só o **SHA-256 do
  token**, então vazar a tabela não permite se passar por ninguém.
- Sessão de 12 horas de inatividade, renovada sozinha durante o uso. Configurável em
  `HORAS_SESSAO`.
- Trocar a senha **derruba as outras sessões** da conta. Redefinir a senha de alguém e
  excluir uma conta também.
- Erro de login espera 600ms e devolve sempre a mesma mensagem, para não revelar quais
  e-mails têm conta nem facilitar força bruta.
- Guardas contra se trancar fora: ninguém exclui a própria conta, nem a última conta de
  TI (ninguém administraria contas), nem a última de RH (ninguém leria a pesquisa).
- **Trava de tentativas.** Por IP: 10 falhas em 15 minutos bloqueiam por 10 minutos
  (HTTP 429 com `Retry-After`), e o IP bloqueado não entra nem com a senha correta. Por
  conta: **atraso crescente, nunca bloqueio** — cada falha recente soma 400ms, até 4s.
  Bloquear por e-mail pareceria mais seguro, mas daria um jeito trivial de trancar o RH
  de fora: bastaria errar a senha dele algumas vezes. As contagens ficam em memória, e
  reiniciar o serviço as zera.

### Se a senha do TI for perdida

Só o TI redefine senha, e só outro TI redefiniria a do TI — com uma única conta de TI,
esquecer a senha trancaria a administração para sempre. Para destravar:

1. No Railway, defina `RESET_SENHA_TI` com uma senha temporária
2. Reinicie o serviço (o deploy já reinicia)
3. Entre como `TI@azime.com.br` com essa senha — o sistema vai pedir uma nova
4. **Remova a variável.** Enquanto ela existir, todo reinício redefine a senha do TI, e
   o log avisa isso em letras garrafais

Não é uma porta dos fundos permanente: é uma alavanca de uso único que você mesmo puxa
e devolve. Se a conta de TI tiver sido apagada direto no banco, ela é recriada.

**Melhor ainda: mantenha duas contas de TI.** Aí uma redefine a senha da outra pela
própria tela de Usuários, sem precisar de variável de ambiente nenhuma.

### Trocando as contas iniciais

`EMAIL_RH`, `EMAIL_TI` e `SENHA_INICIAL` são variáveis de ambiente — ver
[.env.example](.env.example). **Defina `SENHA_INICIAL` no Railway** para que a senha de
partida não fique registrada no repositório. Elas só valem no primeiro boot, quando a
tabela de usuários está vazia; depois disso, não têm mais efeito.

## Onde os dados ficam

Uma tabela `respostas`, uma coluna por campo — em vez de um JSONB só — porque o RH
eventualmente vai querer consultar isto em SQL, e
`WHERE departamento = 'Produção' AND scale_chefia <= 2` é bem mais útil que navegar
dentro de um JSON. O schema sai de [lib/resposta.mjs](lib/resposta.mjs), que é a única
fonte de verdade sobre quais campos existem: acrescentar um campo lá reflete na tabela,
no `INSERT` e no `SELECT` sem tocar em mais nada.

`assets/store.js` decide o modo em tempo de execução:

- **modo `api`** — `GET`/`POST` em `/api/responses`, servido por
  [server.js](server.js) contra o Postgres. É o que vale em produção.
- **modo `local`** — `localStorage`, quando a API não responde.

Em qualquer modo, se o envio falhar a resposta vai para uma fila local e é reenviada na
próxima vez que alguém abrir o site. O `INSERT` usa `ON CONFLICT (id) DO NOTHING`, então
o reenvio nunca duplica. Nenhuma resposta se perde por rede instável.

## Ajustando sem mexer no código

Praticamente tudo que se personaliza está em [assets/config.js](assets/config.js):

| Constante | Para que serve |
|---|---|
| `EMPRESA` | nome da empresa no cabeçalho da área de gestão |
| `SETORES` | a lista de setores do formulário — **é o que faz o "detalhe por setor" existir** |
| `DIMENSOES` | as 10 perguntas de escala 1–5, com rótulo curto (gráficos) e longo (formulário) |
| `ASPECTOS` | opções de "maiores desafios" |
| `STEPS` | a sequência completa do questionário, incluindo perguntas condicionais |

Os textos da página inicial ficam direto em [index.html](index.html), e a marca
(símbolo "A" e o nome) está no topo do arquivo.

### Sobre o campo de setor

O setor é lista fechada (`SETORES`), com um passo extra caso a pessoa marque "Outro".
Se fosse texto livre, "TI", "T.I." e "Tecnologia" virariam três setores diferentes e o
dashboard por setor perderia o sentido.

## Exportação

O botão **Exportar Excel** em `respostas.html` gera um `.xlsx` com cinco abas,
respeitando os filtros ativos na tela:

| Aba | Conteúdo |
|---|---|
| Respostas | uma linha por pessoa, todos os campos, mais média geral e perfil NPS |
| Resumo por setor | respostas, média, eNPS, promotores/neutros/detratores e a média de cada dimensão |
| Dimensões | média, distribuição 1–5 e percentuais negativo/neutro/positivo |
| Desafios | citações e percentual de cada aspecto |
| Comentários | uma linha por resposta aberta, com data, setor, cargo e pergunta |

O arquivo sai com cabeçalho fixo, autofiltro, larguras de coluna e datas como data de
verdade (ordenável no Excel, não texto). [assets/xlsx.js](assets/xlsx.js) monta o
pacote OOXML e o ZIP na mão — não há dependência de CDN, e por isso a exportação
funciona offline.

O botão **CSV** gera a mesma aba principal separada por `;` e com BOM, do jeito que o
Excel em português abre sem estragar os acentos.

## Segurança

O acesso à gestão é autenticado no servidor: sem cookie de sessão válido, `/dashboard.html`
e as demais telas nem chegam a ser entregues — respondem 302 para o login. As rotas de
dados devolvem 401. Ver **Acesso à área de gestão** acima para o funcionamento.

Também vale saber:

- `POST /api/responses` aceita requisição de qualquer origem e **sem autenticação** —
  tem que ser assim, é o endpoint que grava a pesquisa e quem está saindo da empresa não
  tem conta. O servidor valida e limita tudo que entra (campos permitidos, tamanho de
  texto, faixa das notas, 64 KB por envio) e usa consulta parametrizada, nunca SQL
  montado por concatenação. Mas não há proteção contra alguém despejar respostas falsas
  em volume; se isso preocupar, coloque o formulário atrás de um link com token.
- `GET /api/responses` exige sessão **com perfil de RH**. TI recebe 403.
- Não existe endpoint para apagar respostas. Para isso, use o console do Postgres no
  Railway.
- O servidor só entrega o site: `server.js`, `lib/`, `package.json`, `node_modules/` e
  qualquer arquivo `.env` respondem 404, e travessia de caminho (`../`) é bloqueada.
- Todas as respostas saem com `X-Frame-Options: DENY`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: no-referrer` e `X-Robots-Tag: noindex`.

## Estrutura

```
index.html              página inicial
pesquisa.html           o formulário
login.html              entrada da gestão + troca da senha provisória
dashboard.html          panorama
setores.html            detalhe por setor
respostas.html          tabela + exportação
usuarios.html           contas com acesso

server.js               servidor Node: estáticos, /api/responses, /api/login,
                        /api/senha, /api/usuarios, /api/saude
lib/
  resposta.mjs          formato canônico de uma resposta e o saneamento
  db.mjs                Postgres das respostas: schema no boot, listar e gravar
  auth.mjs              scrypt, tokens de sessão, cookies e regras de papel
  usuarios.mjs          contas e sessões (Postgres, ou memória sem banco)
  limite.mjs            trava de tentativas de login (por IP e por conta)

assets/
  tokens.css            cores, tipografia, movimento (claro + escuro)
  auth.css              estilos das telas de entrada
  landing.css           estilos da página inicial
  survey.css            estilos do formulário
  admin.css             estilos da área de gestão
  config.js             setores, dimensões e o questionário inteiro
  store.js              camada de dados (api ↔ localStorage, fila de reenvio)
  stats.js              agregações: eNPS, médias, distribuições, filtros, formatação
  charts.js             gráficos SVG + tooltip + gêmeos em tabela
  xlsx.js               gerador de .xlsx (OOXML + ZIP + CRC-32) e de .csv
  demo.js               conjunto de exemplo com semente fixa
  admin.js              casca comum: cabeçalho, tema, sessão, cartões

railway.json            start command e healthcheck
.env.example            variáveis para rodar local
robots.txt              fora dos buscadores
```

## Notas de design

- **Tema claro e escuro**, cada um com sua paleta declarada — o escuro não é uma
  inversão automática. Segue a preferência do sistema e o botão ☾/☀ do cabeçalho tem a
  palavra final. O herói da página inicial é escuro nos dois temas de propósito: é uma
  superfície de marca, não uma tela de leitura de dados.
- **Cores de dados escolhidas por função, não por gosto**: azul sozinho para
  magnitude, azul↔vermelho com cinza no meio para polaridade (Likert, delta contra a
  média), rampa de um matiz para o mapa de calor. A paleta foi validada para banda de
  luminosidade, piso de croma, separação sob daltonismo (protanopia e deuteranopia) e
  contraste contra a superfície, nos dois temas.
- **Um número grande por tela** (o eNPS), com a leitura em palavras ao lado — a cor
  nunca carrega o significado sozinha.
- Marcas finas, grade em fio de cabelo sólido, rótulo direto só onde importa, e vão de
  2px na cor da superfície separando segmentos que se tocam.
- **Largura fluida.** A área de gestão acompanha a janela, com margem lateral que
  cresce junto (`clamp`), e só para de esticar em 2200px. O formulário é a exceção:
  continua numa coluna estreita e centralizada, porque uma pergunta por tela espalhada
  em 1920px seria pior de responder.
- **Movimento com regra.** Os blocos entram em cascata, as barras crescem a partir da
  própria linha de base (o zero, no caso das divergentes), a linha do tempo se desenha
  da esquerda para a direita e o número principal conta até o valor. Só na primeira
  montagem: redesenho por resize ou por troca de tema não reanima. Trocar um filtro
  reanima, porque aí o dado mudou. Tudo é animação CSS, então quem tem **movimento
  reduzido** ligado no sistema vê o estado final direto.
