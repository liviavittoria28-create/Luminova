# LUMINOVA 4.0.0

Rede social de interesses, fandoms e criatividade. Site estático (HTML, CSS e JS puros) com Supabase
(Auth, banco Postgres com RLS e Storage).

## Estrutura
- `Frontend/` — o site publicado. Cada página tem seu `.html` e, quando precisa, um `.js` do mesmo nome.
  - `luminova-sidebar.js` — núcleo compartilhado: cliente Supabase, sessão, menu lateral, rodapé do menu e área de anúncios.
  - `luminova-theme.js` — tema claro/escuro.
  - CSS, nesta ordem: `style.css` → `luminova-pages.css` → `luminova-aero.css` (tokens e base) → `luminova-3.css` →
    `luminova-aero-max.css` → `luminova-azul.css` (identidade final, carregada por último).
- `Banco de Dados/` — schema, migrações e testes.
- `Backend/versionar-assets.js` — aplica `?v=<versão>` nos assets depois de mudar `LUMINOVA_VERSION` em `supabase-config.js`.

## Banco de dados (Supabase › SQL Editor)
Ordem: `Banco de dados.sql`, `Migracao-completa-LUMINOVA.sql`, `Migracao-2`, `Migracao-3`, `Migracao-4`, `Migracao-5`,
`Migracao-6`, `Migracao-9`, `Migracao-10`. A produção já está na versão 10; a 4.0.0 não exige migração nova.
Configurar no Supabase Auth: Site URL e Redirect URLs para `/boas-vindas.html` e `/redefinir-senha.html`.

## Destino de cada publicação
| Destino | Como fica no banco | Onde aparece |
|---|---|---|
| Feed geral | `posts` sem linha em `community_posts` | só no feed geral |
| Comunidade | `community_posts` com `subcommunity_id` nulo | só no feed da comunidade |
| Subcomunidade | `community_posts` com `subcommunity_id` | só no feed daquela subcomunidade |
| Repost | `community_post_forwards` (post da principal → sub) | na sub, como "encaminhou", com o post original citado |

Comentários e curtidas ficam sempre ligados ao post original (`post_id`), então valem em qualquer feed em que ele apareça.
Cada subcomunidade tem capa, avatar, descrição e regras próprios (`community_subcommunities`); editar a sub não altera a comunidade.

## Testes locais
Containers `lumi-pg` (Postgres 16), `lumi-rest` (PostgREST) e `lumi-proxy` (porta 3400).
```
bash "Banco de Dados/testes/aplicar.sh" --reset
bash "Banco de Dados/testes/rodar-testes.sh"
API=http://localhost:3400/rest/v1 node "Banco de Dados/testes/30-api-comunidade.js"
```
`testes/50-dados-visuais.sql` cria dados FICTÍCIOS só para o banco local — nunca rodar no Supabase.
Para abrir o site contra o banco local: em `localhost`, `localStorage["luminova-api-local"] = "http://localhost:3400"`.

## Área de anúncios
Coluna lateral direita (telas a partir de 1440 px), criada por `luminova-sidebar.js`: `<aside class="lsb-ads">` com o
espaço `<div class="lsb-ads-slot" data-ad-slot="lateral-direita">` de 300×600. Fica vazia até existir um anunciante;
não aparece em Chats, Configurações e Administração nem no celular.

## Inteligência artificial
Os agentes de IA (NOVA BRAIN) foram retirados da plataforma na 3.3.0 (Migração 9). Não há IA ativa no site nem no banco.
Os arquivos antigos estão guardados fora do site, em `_arquivo-IA-removida/`.
