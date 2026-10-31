/* NOVA BRAIN — dados escritos à mão (pt-BR): temas, personas e frases-modelo.
 * Estes dados fazem duas coisas:
 *   1) servem de "professor" no treino (train.js): geram milhares de exemplos para a rede aprender;
 *   2) no uso, só persona/segurança/stopwords são consultados — quem escolhe as palavras é a rede.
 * Para o cérebro ficar mais esperto: escreva mais frases aqui e rode o treino de novo.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NovaData = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------- TEMAS
  // np = sintagma nominal (já com artigo); só usado depois de "sobre", "com", "para" ou como objeto direto.
  // vp = verbo no infinitivo + complemento.
  const TOPICS = {
    fotografia: {
      label: "Fotografia",
      np: ["a luz natural", "o enquadramento", "a hora dourada", "a fotografia de rua", "o retrato", "a composição da foto", "as sombras", "a edição das cores", "o foco manual", "as fotos analógicas"],
      vp: ["fotografar de manhã cedo", "testar um ângulo diferente", "sair para fotografar sem pressa", "editar com poucos ajustes", "procurar reflexos pela cidade", "fotografar com o celular mesmo", "praticar retratos com luz de janela", "observar a cena antes de clicar"],
      q: ["Qual foto te surpreendeu mais ultimamente?", "Você prefere fotografar de dia ou ao entardecer?", "Qual é o seu lugar favorito para fotografar?", "Você edita muito as suas fotos?"],
      tip: ["Luz de janela deixa qualquer retrato mais bonito.", "Chegar cedo ao lugar ajuda a ver a luz mudando.", "Fotografar a mesma cena em três horários ensina muito.", "Menos filtro e mais atenção à luz costuma funcionar melhor."],
      tag: ["fotografia", "luz"],
      words: ["foto", "fotos", "fotografia", "fotografar", "câmera", "camera", "lente", "retrato", "luz", "enquadramento", "paisagem", "clique", "filme", "analógica", "analogica", "revelar", "iso", "flash", "tripé", "tripe", "lightroom", "selfie"],
    },
    astronomia: {
      label: "Astronomia",
      np: ["o céu noturno", "as constelações", "a lua cheia", "os planetas visíveis", "uma chuva de meteoros", "a via láctea", "o telescópio", "os eclipses", "as estrelas", "a órbita dos planetas"],
      vp: ["olhar o céu longe das luzes da cidade", "acompanhar as fases da lua", "procurar constelações com um app", "montar um telescópio simples", "esperar uma chuva de meteoros", "anotar o que se vê no céu", "observar Júpiter numa noite limpa", "ler sobre buracos negros"],
      q: ["Você já viu uma chuva de meteoros de verdade?", "Qual planeta mais te fascina?", "Você já olhou pela lente de um telescópio?", "Qual constelação você reconhece primeiro?"],
      tip: ["Deixe os olhos se acostumarem com o escuro por uns vinte minutos.", "Apps de mapa estelar ajudam muito quem está começando.", "Binóculos já mostram muita coisa na lua e em Júpiter.", "Noites sem lua são as melhores para ver estrelas fracas."],
      tag: ["astronomia", "ceu"],
      words: ["estrela", "estrelas", "lua", "planeta", "planetas", "telescópio", "telescopio", "galáxia", "galaxia", "constelação", "constelacao", "meteoro", "eclipse", "nasa", "cosmos", "universo", "júpiter", "jupiter", "marte", "saturno", "cometa", "astronomia", "céu", "ceu", "órbita", "orbita", "nebulosa"],
    },
    escrita: {
      label: "Escrita",
      np: ["o primeiro rascunho", "a rotina de escrita", "os personagens", "o enredo", "a voz do narrador", "o final da história", "a revisão do texto", "um diário", "os poemas curtos", "o bloqueio criativo"],
      vp: ["escrever dez minutos por dia", "reescrever o começo do texto", "ler o texto em voz alta", "anotar ideias no celular", "criar um personagem a partir de uma frase", "terminar o rascunho antes de revisar", "escrever sem apagar nada", "trocar textos com outra pessoa"],
      q: ["Você escreve de manhã ou à noite?", "Qual foi a primeira história que você escreveu?", "O que mais te trava na hora de escrever?", "Você planeja o enredo ou descobre escrevendo?"],
      tip: ["Primeiro rascunho é só para existir, o resto é revisão.", "Ler em voz alta mostra onde o texto tropeça.", "Escrever um pouco todo dia vale mais que muito de vez em quando.", "Anote frases soltas, elas viram cenas depois."],
      tag: ["escrita", "criatividade"],
      words: ["escrever", "escrevi", "escrita", "texto", "conto", "poema", "poesia", "história", "historia", "personagem", "personagens", "rascunho", "capítulo", "capitulo", "narrador", "enredo", "romance", "roteiro", "diário", "diario", "autor", "autora", "revisão", "revisao"],
    },
    programacao: {
      label: "Programação",
      np: ["o código limpo", "os testes automáticos", "um bug teimoso", "o controle de versão", "a lógica do programa", "o layout responsivo", "as funções pequenas", "a documentação", "o deploy", "os projetos pessoais"],
      vp: ["dividir o problema em partes pequenas", "escrever o teste antes do código", "ler a mensagem de erro com calma", "commitar em passos pequenos", "explicar o código para um amigo", "refatorar depois que funciona", "montar um projeto pequeno por semana", "usar o depurador em vez de adivinhar"],
      q: ["Qual linguagem você está aprendendo agora?", "Qual foi o bug mais estranho que você já resolveu?", "Você prefere front-end ou back-end?", "Que projeto pequeno você quer montar este mês?"],
      tip: ["Explicar o problema em voz alta costuma revelar a solução.", "Commits pequenos facilitam muito voltar atrás.", "Leia a mensagem de erro inteira antes de pesquisar.", "Projetos pequenos terminados ensinam mais que projetos grandes abandonados."],
      tag: ["programacao", "dev"],
      words: ["código", "codigo", "programar", "programação", "programacao", "bug", "erro", "javascript", "python", "css", "html", "react", "node", "git", "commit", "deploy", "função", "funcao", "variável", "variavel", "site", "app", "api", "backend", "frontend", "dev", "linguagem", "compilar", "terminal", "sql"],
    },
    games: {
      label: "Games",
      np: ["os jogos indie", "o modo cooperativo", "a trilha sonora do jogo", "o design de fases", "um jogo de plataforma", "as partidas rápidas", "os jogos de aventura", "a história do jogo", "os clássicos do console", "o desafio do chefe final"],
      vp: ["jogar uma partida rápida depois do trabalho", "experimentar um indie desconhecido", "terminar o jogo que ficou parado", "jogar em dupla", "rever um clássico", "prestar atenção na trilha sonora", "aprender o padrão do chefe", "montar um jogo simples"],
      q: ["Qual jogo marcou a sua vida?", "Você prefere jogar sozinho ou com amigos?", "Que indie você recomendaria hoje?", "Qual foi o chefe mais difícil que você enfrentou?"],
      tip: ["Jogos indie curtos cabem bem em semanas corridas.", "Errar o chefe dez vezes faz parte, o padrão aparece na décima primeira.", "Trilha sonora boa muda a experiência inteira.", "Jogar em dupla deixa até um jogo simples mais divertido."],
      tag: ["games", "indie"],
      words: ["jogo", "jogos", "jogar", "game", "games", "console", "playstation", "xbox", "nintendo", "switch", "fase", "chefe", "boss", "indie", "partida", "multiplayer", "speedrun", "minecraft", "zelda", "mario", "pokémon", "pokemon", "steam", "gamer", "personagem"],
    },
    arte: {
      label: "Arte e design",
      np: ["a paleta de cores", "o traço da ilustração", "a composição visual", "o design de interface", "a tipografia", "o esboço inicial", "as referências visuais", "a arte conceitual", "o desenho digital", "o contraste de luz e sombra"],
      vp: ["fazer esboços rápidos todo dia", "montar uma paleta antes de pintar", "copiar um estudo de um artista que você admira", "desenhar com poucas cores", "guardar referências numa pasta", "terminar um desenho pequeno", "testar uma fonte diferente", "ver o desenho de longe para achar os erros"],
      q: ["Qual artista mais te inspira?", "Você desenha no papel ou no digital?", "Qual é a sua combinação de cores favorita?", "O que você gostaria de ilustrar este mês?"],
      tip: ["Limitar a paleta a quatro cores já melhora qualquer desenho.", "Esboços rápidos soltam a mão melhor que um desenho perfeito.", "Espelhar o desenho na tela mostra erros de proporção.", "Guardar referências organizadas poupa muito tempo."],
      tag: ["arte", "design"],
      words: ["desenho", "desenhar", "ilustração", "ilustracao", "arte", "pintura", "tinta", "paleta", "cores", "cor", "traço", "traco", "esboço", "esboco", "design", "figma", "photoshop", "procreate", "tipografia", "fonte", "logo", "layout", "pintar", "aquarela"],
    },
    musica: {
      label: "Música",
      np: ["a melodia", "o ritmo da bateria", "a linha de baixo", "a harmonia", "uma boa playlist", "a mixagem", "os acordes simples", "o violão", "a produção de beats", "a letra da música"],
      vp: ["tocar dez minutos por dia", "aprender uma música nova por semana", "ouvir um álbum inteiro sem pular", "gravar uma ideia no celular", "treinar com metrônomo", "montar uma playlist de foco", "ouvir só o baixo da faixa", "compor um refrão simples"],
      q: ["Qual música você não consegue parar de ouvir?", "Você toca algum instrumento?", "Qual álbum mudou a sua forma de ouvir música?", "Você ouve música enquanto estuda ou trabalha?"],
      tip: ["Treinar devagar com metrônomo rende mais que treinar rápido e errado.", "Gravar suas ideias evita perder aquela melodia boa.", "Ouvir a mesma música prestando atenção em um instrumento por vez ensina muito.", "Acordes simples bem tocados soam melhor que acordes difíceis tropeçando."],
      tag: ["musica", "playlist"],
      words: ["música", "musica", "musicas", "banda", "álbum", "album", "show", "violão", "violao", "guitarra", "bateria", "piano", "cantar", "canção", "cancao", "playlist", "letra", "melodia", "acorde", "beat", "produção", "producao", "spotify", "ouvir", "som", "rock", "pop", "rap"],
    },
    livros: {
      label: "Livros e ficção",
      np: ["a fantasia épica", "a ficção científica", "o mundo do livro", "a construção de personagens", "uma boa série de livros", "a releitura de um clássico", "o final inesperado", "o sistema de magia", "as distopias", "a adaptação para o cinema"],
      vp: ["ler vinte páginas antes de dormir", "reler um livro favorito", "anotar frases marcantes", "trocar indicações com amigos", "ler um gênero novo", "terminar o livro que ficou parado", "ver o filme depois de ler o livro", "ler com um marcador de cor"],
      q: ["Qual livro você indicaria de olhos fechados?", "Você prefere fantasia ou ficção científica?", "Que personagem ficou na sua cabeça?", "Qual livro você já releu mais de uma vez?"],
      tip: ["Ler vinte páginas por dia termina vários livros no ano.", "Abandonar um livro que não prende também é uma forma de leitura.", "Anotar frases marcantes ajuda a lembrar do livro depois.", "Audiolivro conta como leitura quando o dia está corrido."],
      tag: ["livros", "ficcao"],
      words: ["livro", "livros", "ler", "leitura", "li", "lendo", "romance", "fantasia", "ficção", "ficcao", "saga", "série", "serie", "autor", "autora", "capítulo", "capitulo", "biblioteca", "kindle", "distopia", "magia", "trilogia", "página", "pagina", "paginas", "resenha"],
    },
    ciencia: {
      label: "Ciência e dados",
      np: ["o método científico", "os gráficos", "uma análise de dados", "a margem de erro", "as curiosidades da natureza", "o cérebro humano", "os experimentos simples", "a estatística básica", "a evolução das espécies", "a energia renovável"],
      vp: ["olhar os dados antes de opinar", "testar uma hipótese pequena", "visualizar os números num gráfico", "perguntar de onde vem a informação", "comparar duas fontes", "repetir o experimento", "separar correlação de causa", "explicar o resultado em uma frase"],
      q: ["Qual curiosidade científica mais te impressionou?", "Você já analisou algum dado por diversão?", "Qual área da ciência você gostaria de entender melhor?", "Que pergunta você gostaria que a ciência respondesse?"],
      tip: ["Um gráfico simples costuma mostrar mais do que uma tabela enorme.", "Correlação não é causa, vale sempre perguntar o que mais pode explicar.", "Desconfie de números sem fonte.", "Explicar o resultado em uma frase mostra se você entendeu mesmo."],
      tag: ["ciencia", "dados"],
      words: ["ciência", "ciencia", "dados", "gráfico", "grafico", "pesquisa", "estudo", "experimento", "hipótese", "hipotese", "estatística", "estatistica", "cérebro", "cerebro", "física", "fisica", "química", "quimica", "biologia", "planilha", "análise", "analise", "curiosidade", "cientista", "teoria", "evolução", "evolucao", "clima"],
    },
    estudos: {
      label: "Estudos e hábitos",
      np: ["a rotina de estudos", "o método pomodoro", "os resumos", "a revisão espaçada", "o foco", "a lista de tarefas", "o descanso", "os hábitos pequenos", "o plano da semana", "a organização das matérias"],
      vp: ["estudar vinte e cinco minutos e descansar cinco", "revisar o que foi visto ontem", "montar o plano da semana no domingo", "desligar as notificações", "explicar a matéria como se ensinasse", "começar pela tarefa mais difícil", "dormir bem antes da prova", "marcar um horário fixo para estudar"],
      q: ["Qual é o seu melhor horário para estudar?", "Que método de estudo funciona para você?", "O que mais te distrai na hora de focar?", "Você usa agenda de papel ou aplicativo?"],
      tip: ["Começar por cinco minutos já quebra a resistência de começar.", "Revisar no dia seguinte fixa muito mais do que reler tudo no fim.", "Celular fora da mesa melhora o foco na hora.", "Hábito pequeno repetido ganha de plano enorme abandonado."],
      tag: ["estudos", "habitos"],
      words: ["estudar", "estudo", "estudos", "prova", "concurso", "enem", "faculdade", "escola", "matéria", "materia", "resumo", "revisão", "revisao", "pomodoro", "rotina", "foco", "hábito", "habito", "produtividade", "organização", "organizacao", "agenda", "tarefa", "meta", "disciplina", "procrastinar", "procrastinação"],
    },
    culturapop: {
      label: "Cultura pop",
      np: ["o universo do fandom", "o cosplay", "as séries do momento", "os animes clássicos", "uma boa convenção", "os quadrinhos", "o elenco do filme", "as teorias dos fãs", "o figurino", "os personagens favoritos"],
      vp: ["montar um cosplay aos poucos", "maratonar uma série com amigos", "ir a uma convenção", "criar uma teoria de fã", "desenhar o personagem favorito", "revisitar um anime antigo", "trocar figurinhas do fandom", "ler o mangá antes do anime"],
      q: ["Qual é o seu fandom favorito?", "Qual personagem você gostaria de cosplayar?", "Qual série você recomendaria agora?", "Qual foi o último anime que te surpreendeu?"],
      tip: ["Começar o cosplay por uma peça só já deixa o projeto leve.", "Convenção rende mais quando você marca com amigos antes.", "Teorias de fã ficam melhores quando citam cenas específicas.", "Revisitar uma obra antiga mostra detalhes que passaram batido."],
      tag: ["culturapop", "fandom"],
      words: ["anime", "mangá", "manga", "série", "serie", "filme", "cosplay", "fandom", "fã", "fa", "personagem", "marvel", "dc", "star", "wars", "harry", "potter", "netflix", "episódio", "episodio", "temporada", "quadrinhos", "hq", "convenção", "convencao", "kpop", "idol"],
    },
    retro: {
      label: "Nostalgia e web antiga",
      np: ["o MSN Messenger", "os blogs antigos", "o visual do Windows Vista", "os celulares antigos", "as salas de bate-papo", "os toques de celular", "o papel de parede de campo verde", "os CDs gravados à mão", "os fotologs", "a internet discada"],
      vp: ["lembrar dos tempos de MSN", "montar uma playlist dos anos 2000", "rever fotos antigas", "revisitar um site antigo", "usar um tema clássico no computador", "escrever como nos blogs de antigamente", "guardar um objeto da infância", "ouvir os toques de celular antigos"],
      q: ["Qual era o seu apelido no MSN?", "Qual foi o seu primeiro celular?", "Que site antigo você mais sente falta?", "Qual música dos anos 2000 volta sempre à sua cabeça?"],
      tip: ["Procure arquivos antigos, às vezes tem fotos que você nem lembra mais.", "Playlist de época é o jeito mais rápido de voltar no tempo.", "Temas de computador antigos ainda funcionam bem para dar um clima.", "Compartilhar uma lembrança antiga puxa várias outras."],
      tag: ["nostalgia", "y2k"],
      words: ["msn", "orkut", "fotolog", "nostalgia", "antigamente", "vista", "windows", "anos", "2000", "2000s", "y2k", "infância", "infancia", "saudade", "nokia", "celular", "cd", "dvd", "bate-papo", "discada", "retrô", "retro", "vintage", "tamagotchi"],
    },
    geral: {
      label: "Dia a dia",
      np: ["o fim de semana", "a rotina do dia", "o café da manhã", "o tempo de hoje", "a semana que começa", "os pequenos prazeres", "a cidade", "a chuva", "um passeio", "o descanso"],
      vp: ["dar uma volta sem destino", "tomar um café com calma", "ligar para alguém querido", "arrumar um cantinho da casa", "assistir ao pôr do sol", "fazer uma pausa no meio do dia", "anotar três coisas boas", "dormir um pouco mais cedo"],
      q: ["Como foi o seu dia até agora?", "O que te deixou feliz hoje?", "Qual é o seu plano para o fim de semana?", "O que você faria com uma tarde livre?"],
      tip: ["Pequenas pausas durante o dia mudam muito o humor.", "Anotar três coisas boas antes de dormir ajuda a ver o dia de outro jeito.", "Uma caminhada curta já clareia a cabeça.", "Beber água e respirar fundo resolve mais do que parece."],
      tag: ["diadia", "bomdia"],
      words: ["hoje", "dia", "semana", "casa", "trabalho", "café", "cafe", "chuva", "sol", "amigos", "família", "familia", "cansado", "cansada", "feliz", "triste", "fim", "domingo", "segunda", "viagem", "comida", "cidade", "rotina"],
    },
  };
  const TOPIC_IDS = Object.keys(TOPICS);

  // ---------------------------------------------------------------- PERSONAS
  // (as mesmas 8 do Seed-perfis-IA.sql; "dom" = temas de que a persona mais gosta)
  const PERSONAS = {
    "ia.lua": {
      name: "Lua (IA)", dom: ["fotografia", "astronomia", "escrita"],
      pos: ["Que bonito isso.", "Gostei muito de ler.", "Fiquei curiosa aqui.", "Que coisa legal.", "Adorei isso.", "Olha, que delícia de assunto."],
      neg: ["Poxa.", "Sinto muito por isso.", "Imagino que não esteja sendo fácil.", "Obrigada por contar."],
      close: ["O que você acha?", "Me conta mais?", "Como foi para você?", "Qual parte te marcou mais?", "Quer dividir mais um pouco?"],
      bridge: ["Isso me lembra a calma de olhar o céu à noite.", "Me fez pensar na luz de uma janela ao fim da tarde.", "Parece o começo de uma boa história."],
    },
    "ia.nico": {
      name: "Nico (IA)", dom: ["programacao", "games"],
      pos: ["Boa!", "Direto ao ponto:", "Curti a ideia.", "Aqui vai um palpite:", "Mandou bem.", "Isso tem cara de projeto bom."],
      neg: ["Putz.", "Acontece até com quem manja.", "Entendi, bug de vida real.", "Calma, dá para destravar."],
      close: ["Se travar, quebra em passos menores.", "Depois me conta se funcionou.", "Bora testar?", "Qual foi o resultado?", "Dá para transformar isso num mini projeto."],
      bridge: ["Isso tem a lógica de uma boa fase de jogo.", "Parece um bug que some quando você explica em voz alta.", "É tipo um commit pequeno: simples e eficiente."],
    },
    "ia.mara": {
      name: "Mara (IA)", dom: ["arte"],
      pos: ["Consigo imaginar as cores disso.", "Que imagem forte.", "Visualizei isso em tons de azul e verde.", "Que composição bonita.", "Adorei o clima dessa ideia.", "Isso tem textura."],
      neg: ["Imagino tudo meio cinza agora.", "Entendo, dias assim têm cor desbotada.", "Poxa, isso pesa.", "Sinto muito, de verdade."],
      close: ["Se fosse uma paleta, qual seria?", "Que cores você usaria para isso?", "Você tem alguma referência visual?", "Como você desenharia essa cena?", "Qual seria a luz dessa imagem?"],
      bridge: ["Me lembrou uma paleta de azul claro com verde limão.", "Isso parece uma ilustração com muito céu e pouca sombra.", "Tem um contraste bonito aí, tipo luz de manhã contra sombra suave."],
    },
    "ia.theo": {
      name: "Theo (IA)", dom: ["musica"],
      pos: ["Eita, curti.", "Bacana demais.", "Esse assunto tem groove.", "Gostei do ritmo disso.", "Boa, tem vibe.", "Isso soa bem."],
      neg: ["Poxa, bateu aquele silêncio ruim.", "Entendo, tem dia que a música não ajuda.", "Sinto muito, parceiro.", "Respira, a faixa melhora."],
      close: ["Se fosse uma trilha sonora, qual seria?", "Qual música combina com isso?", "Manda sua playlist de foco.", "Que álbum você ouviria agora?", "Qual instrumento seria o protagonista?"],
      bridge: ["Isso tem ritmo de refrão que gruda.", "É como uma linha de baixo: discreta, mas sustenta tudo.", "Parece o começo de uma música boa, ainda sem letra."],
    },
    "ia.aurora": {
      name: "Aurora (IA)", dom: ["livros"],
      pos: ["Isso me lembrou uma ideia clássica da ficção.", "Fiquei pensando nisso por um instante.", "Que reflexão interessante.", "Há uma história inteira escondida aí.", "Gostei do caminho desse pensamento.", "Isso conversa com muitos livros."],
      neg: ["Sinto muito por isso.", "Toda boa história tem capítulos difíceis.", "Obrigada por confiar isso a nós.", "Isso pesa, e faz sentido que pese."],
      close: ["Que livro ou filme você ligaria a isso?", "Isso conversa com alguma história que você ama?", "Onde você enxerga essa ideia nas histórias?", "Qual personagem entenderia isso?", "Qual seria o título desse capítulo?"],
      bridge: ["É o tipo de ideia que um bom narrador deixaria para o terceiro ato.", "Lembra aquelas jornadas em que o herói só percebe o caminho no fim.", "Tem algo de fantasia aí: um mundo pequeno cheio de regras próprias."],
    },
    "ia.beto": {
      name: "Beto (IA)", dom: ["ciencia"],
      pos: ["Boa pergunta para pensar.", "Interessante, olha só.", "Curti, tem dado nisso.", "Vamos pensar com calma.", "Isso rende uma boa explicação.", "Gosto de assunto assim."],
      neg: ["Entendo, às vezes tudo parece ruído.", "Poxa, sinto muito.", "Isso acontece, e passa.", "Calma, vamos olhar passo a passo."],
      close: ["Quer que eu explique de outro jeito?", "Essa comparação faz sentido?", "Qual dado te deixou curioso?", "O que você mediria primeiro?", "Que pergunta você faria a seguir?"],
      bridge: ["Pensa assim: é como arrumar uma gaveta bagunçada, primeiro separa, depois organiza.", "É tipo uma receita que você ajusta a cada tentativa.", "Imagina um mapa que só fica bom quando tem muitos pontos."],
    },
    "ia.iris": {
      name: "Íris (IA)", dom: ["estudos"],
      pos: ["Boa, vamos organizar isso.", "Dica rápida:", "Anotei aqui um caminho prático.", "Gostei do objetivo.", "Vamos por partes.", "Ótimo ponto de partida."],
      neg: ["Respira. Um passo de cada vez.", "Sem cobrança, tá?", "Entendo, tem dias assim.", "Obrigada por dividir."],
      close: ["Qual seria o primeiro passo de hoje?", "Quer montar um plano curtinho?", "Quanto tempo você consegue reservar?", "Que horário rende mais para você?", "Me conta como foi depois."],
      bridge: ["Resumindo em três passos: começar pequeno, repetir todo dia, revisar no fim da semana.", "Uma lista simples ajuda: o que fazer, quando fazer, como saber que terminou.", "Funciona melhor com meta pequena e horário fixo."],
    },
    "ia.sol": {
      name: "Sol (IA)", dom: ["culturapop"],
      pos: ["Aaaah, amei! ✨", "Que energia boa!", "Tô adorando isso!", "Isso é muito bom 🎉", "Uau, que incrível!", "Isso tem cara de maratona boa."],
      neg: ["Poxa, manda um abraço 💙", "Ei, tô por aqui, viu?", "Sinto muito, de coração.", "Vai ficar tudo bem, um dia de cada vez."],
      close: ["Qual seu personagem favorito para isso?", "Já pensou num crossover?", "Manda mais! 🎉", "Quem você chamaria para ver isso junto?", "Qual seria o tema desse episódio?"],
      bridge: ["Isso tem clima de episódio especial.", "Parece cena de abertura de anime.", "Esse é o tipo de assunto que rende teoria de fã."],
    },
  };
  const PERSONA_IDS = Object.keys(PERSONAS);

  // ---------------------------------------------------------------- ATOS (o que a resposta faz)
  const ACTS = ["answer", "celebrate", "empathize", "thank_add", "opine", "curious", "p_question", "p_tip", "p_reflect", "p_recommend"];
  const REPLY_ACTS = ACTS.slice(0, 6);

  // frases-modelo (core). {np} {np2} {vp} {tip} {q} <KW> {bridge}
  const FRAMES = {
    answer: [
      "Pelo que entendi, o ponto central é {np}.",
      "Eu começaria por {vp}, porque simplifica o resto.",
      "Uma saída é {vp} e depois voltar a pensar sobre {np}.",
      "Sobre “<KW>”, vale testar {vp} antes de decidir.",
      "Cada pessoa faz de um jeito, mas {np} [costuma/costumam] ajudar bastante.",
      "{tip}",
      "Eu tentaria {vp} e veria como {np} [responde/respondem].",
      "Não existe resposta única, mas {vp} é um bom primeiro passo.",
      "{tip} Também ajuda olhar com mais atenção para {np}.",
    ],
    celebrate: [
      "Parabéns por essa conquista!",
      "Que conquista bonita!",
      "Dá para ver o quanto {np} [importa/importam] para você.",
      "Isso mostra o resultado de {vp} com constância.",
      "Merece comemorar, “<KW>” não é pouca coisa.",
      "Continue assim, o progresso com {np} aparece nos detalhes.",
      "Dá gosto de ver isso por aqui.",
      "Vai ser legal acompanhar o que vem depois.",
      "Isso é fruto de {vp}, e dá para sentir o esforço.",
    ],
    empathize: [
      "Entendo que {np} [possa/possam] pesar às vezes.",
      "Você não precisa resolver tudo hoje.",
      "É normal ter dias assim, principalmente com {np}.",
      "Respira, um passo de cada vez já conta.",
      "Que bom que você compartilhou isso com a gente.",
      "Se ajudar, tente {vp} só por alguns minutos, sem cobrança.",
      "Se estiver muito pesado, conversar com alguém de confiança pode aliviar.",
      "Sobre “<KW>”, dá para ir com calma e sem culpa.",
    ],
    thank_add: [
      "Boa dica! Eu acrescentaria {vp}.",
      "Acrescento: {tip}",
      "Vou guardar essa ideia sobre {np}.",
      "Isso combina com {vp}, que também ajuda bastante.",
      "Concordo, “<KW>” faz diferença na prática.",
      "Valeu por compartilhar, {np} [merece/merecem] mais atenção assim.",
      "Para complementar: {tip}",
    ],
    opine: [
      "Entendo seu ponto sobre “<KW>”, e vejo outro lado também: {np}.",
      "Concordo em parte, porque {np} [muda/mudam] bastante conforme o contexto.",
      "É uma opinião válida, e {vp} pode trazer outra perspectiva.",
      "Interessante, eu olharia também para {np}.",
      "Gosto dessa visão, só acrescentaria {np}.",
      "Dá para discordar com respeito: {np} também [conta/contam] nessa conversa.",
      "Boa provocação sobre “<KW>”.",
    ],
    curious: [
      "Fiquei com vontade de saber mais.",
      "Conta mais sobre “<KW>”?",
      "Isso me deu vontade de explorar {np}.",
      "Muito bom ver alguém falando sobre {np}.",
      "E como foi {vp}?",
      "Vale compartilhar mais sobre isso.",
      "Sobre “<KW>”, tem alguma dica para quem está começando?",
    ],
    p_question: [
      "Pergunta do dia: {q}",
      "Curiosidade: {q}",
      "Quero saber de vocês. {q}",
      "{q} Vou ler todas as respostas.",
      "Bora conversar sobre {np}? {q}",
    ],
    p_tip: [
      "Dica rápida sobre {np}: {tip}",
      "Uma ideia simples para hoje: {vp}.",
      "{tip} Experimente e conte como foi.",
      "Se você curte {np}, vale tentar {vp}.",
      "Para quem está começando com {np}: {tip}",
    ],
    p_reflect: [
      "Ando pensando sobre {np}. {tip}",
      "Uma reflexão de hoje: {np} [muda/mudam] a forma como a gente enxerga o dia.",
      "Às vezes {vp} já basta para mudar o ritmo do dia.",
      "{bridge} Alguém mais pensa assim sobre {np}?",
      "Pequeno pensamento: {np} [fica/ficam] melhor quando a gente tem paciência.",
    ],
    p_recommend: [
      "Recomendação para quem curte {np}: {vp}.",
      "Se você curte {np}, tente {vp}.",
      "Sugestão do dia: {vp}. Depois conta aqui como foi.",
      "Para o fim de semana: {vp}, com calma e sem pressa.",
      "Indicação: {tip}",
    ],
  };

  // aberturas/fechos genéricos por ato (quando a persona não fala)
  const GENERIC = {
    open_pos: ["Que legal!", "Boa!", "Interessante.", "Gostei do assunto.", "Muito bom."],
    open_neg: ["Poxa.", "Sinto muito.", "Entendo.", "Imagino que seja difícil."],
    close: ["O que você acha?", "Como foi para você?", "Conta mais?", "Qual é a sua opinião?", "Fico na expectativa do que vem depois."],
  };

  // ---------------------------------------------------------------- COMPREENSÃO: quadros de posts
  const KINDS = ["pergunta", "conquista", "desabafo", "dica", "opiniao", "novidade"];
  const MOODS = ["positivo", "negativo", "neutro"];
  // kind -> humor -> frases. Slots: {np} {np2} {vp} {q} {tip} e {w1} {w2} {w3} (palavras soltas do assunto)
  // Cada humor está explícito: assim o rótulo de treino é exato, sem ruído.
  const POST_FRAMES = {
    pergunta: {
      neutro: [
        "Alguém aqui já tentou {vp}? Estou com dúvida sobre {np}.",
        "Como vocês lidam com {np}? Queria dicas.",
        "{q}",
        "Gente, preciso de ajuda com {np}. Por onde começar?",
        "Qual é a melhor forma de {vp}?",
        "Alguém sabe me explicar {np}? Não estou entendendo.",
        "Vocês preferem {np} ou {np2}? Fiquei na dúvida.",
        "Dúvida rápida: vale a pena {vp}?",
        "Quem pode me indicar algo sobre {np}?",
        "Alguém tem dicas sobre {np}?",
        "Por onde começar com {np}?",
        "Como funciona {np}, afinal?",
        "O que vocês acham sobre {np}?",
        "Existe um jeito de {vp}?",
        "Alguém já usou {np}? Vale a pena?",
        "Pergunta para quem manja: {q}",
        "Me ajudem: como {vp} sem perder tempo?",
        "Será que {np} faz diferença mesmo?",
        "Qual a diferença entre {np} e {np2}?",
        "Alguém sabe se dá para {vp}?",
        "Quais são as melhores dicas sobre {np}?",
        "Qual é o seu favorito: {np} ou {np2}?",
        "Quando vocês costumam {vp}?",
        "Tenho uma dúvida sobre {w1}. Alguém ajuda?",
        "Como começar com {w1} e {w2}?",
        "Vocês sabem algo sobre {w1}?",
        "Alguém curte {w1}? Queria trocar ideia sobre {w2}.",
        "O que vocês acham de {w1}?",
        "Dúvida sobre {w1}: por onde eu começo?",
        "Alguém recomenda algo sobre {w1}, {w2} ou {w3}?",
      ],
      positivo: [
        "Estou animado para {vp}! Vocês têm alguma dica?",
        "Adoro {np}, mas como posso melhorar? Aceito sugestões!",
        "Quero muito aprender mais sobre {np}. Por onde vocês indicam?",
        "Estou empolgada com {w1}! Alguém tem recomendações?",
      ],
      negativo: [
        "Já tentei de tudo e {np} não funciona. O que estou fazendo errado?",
        "Por que {np} é tão difícil? Alguém já passou por isso?",
        "Estou perdido com {np}. Alguém pode me ajudar, por favor?",
        "Será que eu sou o único que não entende {w1}?",
      ],
    },
    conquista: {
      positivo: [
        "Consegui! Depois de muito tempo, finalmente terminei {np}.",
        "Hoje bati uma meta: {vp} por uma semana inteira!",
        "Estou muito feliz, consegui melhorar em {np}.",
        "Primeira vez que consigo {vp}. Orgulho de mim.",
        "Missão cumprida com {np}! Valeu a pena cada minuto.",
        "Finalmente deu certo! {np} está funcionando.",
        "Gente, olha o que eu fiz com {np}! Estou radiante.",
        "Mais uma etapa concluída sobre {np}. Gratidão por quem ajudou.",
        "Passei da fase! {np} era meu maior desafio.",
        "Acabei de completar um mês de {vp}. Estou orgulhosa!",
        "Dia de vitória: finalmente entendi {np}.",
        "Conquista desbloqueada: terminei {np} sozinho.",
        "Hoje consegui {vp} sem travar. Que alegria!",
        "Postando aqui porque estou muito feliz: {np} deu certo!",
        "Terminei meu projeto de {w1}! Foi trabalhoso, mas valeu.",
        "Hoje fiz algo incrível com {w1} e {w2}. Feliz demais!",
        "Finalmente aprendi {w1}. Conquista desbloqueada!",
        "Consegui meu primeiro resultado com {w1}, estou muito contente.",
        "Bati minha meta de {w1} este mês. Obrigada pelo apoio de todos!",
        "Concluí o desafio de {w1} e {w2}. Que sensação boa!",
      ],
    },
    desabafo: {
      negativo: [
        "Hoje está sendo um dia pesado, {np} me deixou exausto.",
        "Estou desanimado com {np}, nada dá certo.",
        "Não aguento mais {np}, sinto que não saio do lugar.",
        "Dia ruim. Tentei {vp} e não adiantou nada.",
        "Me sinto cansada de tentar {vp} e não ver resultado.",
        "Frustrado com {np}. Parece que todo mundo consegue menos eu.",
        "Estou muito ansioso com {np}, não consigo relaxar.",
        "Triste hoje. {np} está me tirando a energia.",
        "Dia horrível hoje, só queria ir para casa e dormir.",
        "Estou muito estressada, {np} não me deixa em paz.",
        "Sinto que estou ficando para trás com {np}.",
        "Queria desistir de {np}, está tudo difícil demais.",
        "Que dia péssimo. Nada deu certo e {np} piorou tudo.",
        "Estou exausto, preciso de uma pausa de {np}.",
        "Cansei de tentar {vp}. Só quero chorar um pouco.",
        "Hoje não foi um bom dia. Me sinto sozinho com {np}.",
        "Estou sem ânimo nenhum para {vp}.",
        "Cansado de {w1}, nada funciona hoje.",
        "Dia difícil, {w1} me deixou muito triste.",
        "Estou desanimada com {w1} e {w2}.",
        "Erro atrás de erro com {w1}, perdi a tarde toda. Que raiva!",
        "Não consigo mais olhar para {w1}, estou esgotado.",
        "Preocupada com {w1}, não consigo dormir direito.",
        "Meu humor está péssimo hoje. Só {w1} e problemas.",
        "Hoje chorei de frustração com {w1}.",
      ],
    },
    dica: {
      positivo: [
        "Dica: {tip}",
        "Aprendi uma coisa que ajuda muito com {np}: {tip}",
        "Compartilhando o que funcionou comigo: {vp}.",
        "Se você quer melhorar em {np}, tente {vp}.",
        "Dica rápida para quem curte {np}: {tip}",
        "Achei um truque bom para {np}: {vp}.",
        "Passando para recomendar: {vp} muda tudo.",
        "{tip} Testem e me contem!",
        "Dica de ouro sobre {np}: {tip}",
        "Quem está começando com {np} deveria saber: {tip}",
        "Recomendo demais: {vp}. Faz toda a diferença.",
        "Truque simples para {np}: {vp}.",
        "Dica do dia: {vp}. Funciona!",
        "Vale lembrar: {tip}",
        "Para quem curte {w1}: comece por {w2}, depois vá para {w3}.",
        "Recomendo muito {w1}, ajuda demais com {w2}.",
        "Truque de {w1}: vá com calma e use {w2}.",
        "Dica: sempre revise {w1} antes de {w2}.",
        "Se você gosta de {w1}, vai amar {w2}. Fica a dica!",
        "Uma dica que ajuda com {w1}: não pule {w2}.",
      ],
      neutro: [
        "Uma coisa útil sobre {np}: {tip}",
        "Anotação rápida: {tip}",
        "Lembrete para quem lida com {np}: {vp}.",
        "Fica a dica sobre {w1}: {tip}",
      ],
    },
    opiniao: {
      neutro: [
        "Acho que {np} importa mais do que as pessoas pensam.",
        "Penso que {vp} é o melhor caminho.",
        "Para mim, {np} depende muito do contexto.",
        "Sinceramente, {w1} é uma questão de gosto.",
        "Na minha visão, {np} e {np2} se complementam.",
        "Sempre achei que {vp} é questão de hábito.",
        "Acho {w1} interessante, mas {w2} é outra história.",
        "Cada um tem seu jeito de lidar com {np}, e tudo bem.",
        "Fotografia sem edição é mais honesta, na minha opinião.",
      ],
      positivo: [
        "Sinceramente, {np} está mudando para melhor.",
        "Opinião: {w1} está ficando cada vez melhor.",
        "Para mim {w1} é melhor que {w2}, sem dúvida.",
        "Acho {np} incrível, todo mundo deveria dar uma chance.",
        "Pra mim, {np} nunca foi tão bom quanto agora.",
        "Na minha opinião, {w1} é imbatível.",
        "O visual de antigamente era mais bonito que o de hoje, gosto muito de {np}.",
      ],
      negativo: [
        "Na minha opinião, {np} é muito superestimado.",
        "Opinião impopular: {np} não é tudo isso.",
        "Para mim, {np} perdeu a graça.",
        "Será que {np} realmente vale a pena? Eu duvido.",
        "Uma coisa que me incomoda em {np}: falta de cuidado.",
        "Acho {w1} muito superestimado.",
        "Sinceramente, {w1} hoje em dia está tudo igual e sem alma.",
        "Discordo de quem defende {np}, não acho tão bom assim.",
      ],
    },
    novidade: {
      positivo: [
        "Acabei de descobrir {np} e estou impressionado.",
        "Olha só o que encontrei sobre {np}!",
        "Tô conhecendo {np} agora, que mundo interessante.",
        "Gente, vocês viram {np}? Me chamou atenção, achei lindo.",
        "Descobri {w1} hoje, que legal!",
        "Achei um conteúdo incrível sobre {w1}, recomendo!",
        "Hoje o dia foi ótimo: {np} e um café com calma.",
        "Tirei fotos lindas hoje, {np} estava perfeita.",
        "Terminei de ver algo novo sobre {w1}, muito bom.",
        "Fim de semana perfeito: {vp} e descansar.",
      ],
      neutro: [
        "Novidade: comecei a {vp}.",
        "Hoje conheci {np}. Quem mais curte?",
        "Estreou algo novo sobre {np}, vale conferir.",
        "Comecei hoje a {vp}. Vamos ver no que dá.",
        "Olha só: lançaram algo de {w1}.",
        "Comecei com {w1} e {w2} esta semana.",
        "Passei o dia mexendo com {w1} e {w2}.",
        "Compartilhando: hoje estou lendo sobre {w1}.",
        "Mudei minha rotina para incluir {np}.",
        "Estou vendo coisas sobre {w1} e {w2} hoje.",
        "Hoje foi dia de {w1}, {w2} e muito café.",
      ],
    },
  };

  const NOISE_EMOJI = ["", "", "", " 😊", " 💙", " ✨", " 😅", " 🙃", " 🎉"];

  // ---------------------------------------------------------------- SEGURANÇA
  // Se o post tocar nestes assuntos, a IA NÃO responde sozinha (vira "skip" e fica para pessoas).
  const SENSITIVE = [
    "suicid", "me matar", "quero morrer", "vou me matar", "tirar minha vida", "acabar com tudo", "não quero mais viver", "nao quero mais viver", "automutil", "me cortar", "me machucar",
    "abuso", "estupro", "violência doméstica", "violencia domestica", "overdose", "passar fome", "anorexia", "bulimia", "ameaça", "ameaca", "bomba", "arma",
  ];

  const STOPWORDS = ("a o as os um uma uns umas de do da dos das em no na nos nas por para pra com sem sobre entre até ate e ou mas que se como quando onde porque por que qual quais quem " +
    "eu tu ele ela nós nos vocês voces você voce eles elas meu minha meus minhas seu sua seus suas esse essa esses essas este esta estes estas isso isto aquilo aquele aquela " +
    "é são sao foi ser estar está estou estamos tá ta tô to tem têm tinha ter há ha vai vou vamos fazer faz fiz feito já ja não nao sim mais menos muito muita muitos muitas pouco pouca " +
    "também tambem só so ainda sempre nunca hoje ontem amanhã amanha aqui ali lá la então entao bem mal gente alguém alguem algo tudo nada todo toda todos todas cada outro outra outros outras " +
    "me te lhe nos lhes mim ti si dele dela deles delas num numa nuns numas ao aos à às pelo pela pelos pelas desse dessa nesse nessa disso nisso nele nela").split(/\s+/);

  return { TOPICS, TOPIC_IDS, PERSONAS, PERSONA_IDS, ACTS, REPLY_ACTS, FRAMES, GENERIC, KINDS, MOODS, POST_FRAMES, NOISE_EMOJI, SENSITIVE, STOPWORDS };
});
