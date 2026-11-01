# LUMINOVA 3.5.0 — estado desta entrega

## Feito e testado
- **Segurança (Banco de Dados/Migracao-4-LUMINOVA-3x.sql, schema_version 4)**: corrigida falha crítica em que qualquer pessoa podia entrar em conversas privadas alheias alterando `conversation_members` (confirmada em teste antes da correção); mensagens não podem mais ser movidas entre conversas; bloqueio impede mensagens e desfaz follows; membros leem comunidades privadas; username único sem diferenciar maiúsculas; posts de contas privadas/bloqueadas ocultos; anti-spam.
  Testes locais (Postgres 16 + stub Supabase): `bash "Banco de Dados/testes/aplicar.sh" --reset` e `bash "Banco de Dados/testes/rodar-testes.sh"` → **17/17 isolamento, 34/34 funcionais**. Antes da migração: 10/16.
- **LGPD**: documentos versionados, aceite registrado no cadastro, preferências de privacidade, solicitações de titulares, exportação JSON, exclusão de conta com transferência de comunidades; termos.html e privacidade.html escritos para projeto acadêmico (sem CNPJ; contato pela Central de privacidade; idade mínima 13 anos).
- **Cadastro/login/recuperação**: index.html + index.js + luminova-auth.js + redefinir-senha.html (verificação de username com sugestões checadas no banco, e-mail existente, mensagens amigáveis, link expirado, "manter conectado"). Validação local testada no navegador; **fluxo real contra Supabase NÃO testado** (não usei a produção).
- **Novas páginas**: notificacoes, configuracoes (central de privacidade), boas-vindas; feed (geral.js) com editar/excluir/denunciar/bloquear/salvar/paginação/"Para você"/recomendações; design system luminova-3.css.

## Ordem de aplicação no Supabase
1. Migracao-4-LUMINOVA-3x.sql  2. Migracao-5-LUMINOVA-correcao-comunidades.sql  3. Migracao-6-LUMINOVA-posts-de-comunidade.sql  4. Migracao-9-LUMINOVA-remover-IA.sql  5. Migracao-10-LUMINOVA-feed-da-subcomunidade.sql
(As Migrações 7 e 8 e os seeds de IA não fazem mais parte do projeto. Se já foram rodados, tudo bem: a Migração 9 limpa o que eles criaram.)
Substituir `https://luminova.netlify.app` pelo domínio real (canonical/OG). Configurar no Supabase Auth: Site URL e Redirect URLs para `/boas-vindas.html` e `/redefinir-senha.html`.

## Pendente (não feito)
- geral.js novo ainda não verificado no navegador; perfil.html: remover padrões da conta Livinha (selo "Perfil verificado" fixo, rótulo "CRIADORA", frase de capa "Minha jornada…", filtros fixos do mural).
- perfil-publico (bloquear/denunciar/perfil de agente), chats (denunciar/bloqueio na UI), explorar, admin (moderação de denúncias, solicitações LGPD, painel `luminova_platform_health`), comunidades.
- Redesign aplicado só às páginas novas/landing; demais páginas usam o tema aero anterior + ajustes globais.
- SEO: robots.txt, sitemap.xml, _headers, og image, metas das páginas antigas.
- (feito na 3.4.0, ver abaixo) remoção de código morto; documentação completa, testes E2E de autenticação, avaliação completa da NOVA BRAIN.

## 3.3.0 — inteligência artificial removida
- A LUMINOVA não tem mais agentes de IA: sem página NOVA BRAIN, sem selo "IA", sem memória de agentes, sem executor (`agent-runner`) e sem GitHub Actions.
- **Migracao-9-LUMINOVA-remover-IA.sql** apaga de vez os perfis de IA (8 agentes + 100 do elenco) e tudo deles: publicações, comentários, curtidas,
  seguidores, participações em comunidades, notificações e conversas privadas com eles. Contas e publicações de pessoas não são tocadas.
  Também bloqueia `luminova_ai_can_act` (sempre falso), então um executor antigo não consegue mais publicar.
- Testado em banco local que já tinha os 108 perfis de IA e 109 posts deles: `bash "Banco de Dados/testes/40-remover-ia.sh"` → **13/13**;
  rodar a migração duas vezes não dá erro. Suíte normal: 17/17 isolamento, 33/33 funcionais, 10/10 posts de comunidade.
- Os arquivos antigos de IA foram guardados (não apagados) em `LUMINOVA - Copia/_arquivo-IA-removida/`, fora do site.
- Se o GitHub Actions dos agentes chegou a ser ativado: no repositório, aba Actions › "Agentes NOVA BRAIN" › "..." › Disable workflow, e apague o secret `SUPABASE_SERVICE_ROLE_KEY`.

## 3.4.0 — limpeza do projeto e identidade azul
**Arquivado (não apagado) em `LUMINOVA - Copia/_arquivo-limpeza-2026-11-01/`:**
- `luminova-navigation.js`, `luminova-social.js`, `script.js`, `supabase-perfil.js`: nenhuma página carregava (código das versões 1.x/2.x).
- `render.yaml`: descrevia um backend Python (`backend/main.py`) que não existe; o site no Render é estático.
- `netlify.toml`: do protótipo antigo na Netlify.
- `package.json`, `package-lock.json` e `node_modules/`: só serviam ao executor de agentes de IA, já removido (e `node_modules` seria publicado junto com o site).
- `img/cena-aero.svg` e `img/cena-aero-noite.svg`: fundo ilustrado substituído pelo azul. Uma cópia ficou em `divulgacao/` para o gerador do vídeo.
- `Banco de Dados/testes/40-remover-ia.sh`: teste da remoção da IA, dependia de arquivos já arquivados.
- Cópia de todo HTML, CSS e JS como estava antes (`css-antes-da-limpeza/`, `html-js-antes/`), para comparar ou voltar.

**CSS:** ~87 KB de regras que não eram usadas por nenhuma página saíram (a maior parte de `style.css`, que caiu de 127 KB para 49 KB).
A busca só remove regras cujas classes não aparecem em nenhum HTML/JS (prefixos montados em JS, como `lt-` + tipo, são preservados).

**Novo tema:** `Frontend/luminova-azul.css`, carregado por último em todas as páginas. Fundo azul uniforme com profundidade e grade sutil,
vidro translúcido azulado, botões de gel azul/ciano, posts, comentários e respostas com fio ciano, árvore de habilidades em painel azul,
conquistas como medalhas (desbloqueada × bloqueada também por texto), sem animações decorativas, cantos retos, modo claro e escuro.
Para voltar ao visual 3.3: tirar o `<link>` de `luminova-azul.css` das páginas (e restaurar os arquivos da pasta de arquivo, se quiser).
Cores e capa escolhidas pela pessoa em "Personalizar perfil" e pelo dono em "Personalizar espaço" continuam valendo.

**Testes:** 17/17 isolamento, 33/33 funcionais, 10/10 posts de comunidade; todas as páginas abertas logadas sem erro de JavaScript;
publicar, curtir, salvar, comentar e responder (feed e comunidade) testados pela interface; sem rolagem lateral em 375 px.
`Banco de Dados/testes/50-dados-visuais.sql` cria dados FICTÍCIOS só para o banco local (nunca rodar no Supabase).

## 3.5.0 — feed próprio da subcomunidade e "Encaminhar"
- **Migracao-10-LUMINOVA-feed-da-subcomunidade.sql** (não destrutiva, pode rodar mais de uma vez):
  `community_posts.subcommunity_id` marca o post feito dentro de uma subcomunidade; a tabela `community_post_forwards`
  guarda os encaminhamentos. Regras no banco: sub da mesma comunidade, só membro ativo posta/encaminha, sem encaminhar
  duas vezes para a mesma sub, privacidade da comunidade principal vale para tudo. Apagar uma sub devolve os posts à comunidade principal.
- **Subcomunidade:** abre no Feed; mostra só os posts feitos nela e os encaminhados ("↪ encaminhado por Fulano"). O que é postado
  ali fica só ali. O chat continua na aba ao lado.
- **Comunidade principal:** mostra tudo; posts de subcomunidade têm a etiqueta "em ◈ Nome" (link para a sub); cada post tem o botão
  "↪ Encaminhar" para mandar a uma subcomunidade. Nada de comunidade/subcomunidade vai para o feed geral da LUMINOVA.
- **Testes:** `testes/27-subcomunidades.sql` → 13/13 (total: 73 testes, todos passando). Interface testada: encaminhar, abrir a sub,
  postar na sub, ver a etiqueta na principal.
