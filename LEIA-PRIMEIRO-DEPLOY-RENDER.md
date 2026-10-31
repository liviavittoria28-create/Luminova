# LumiNova 3.0.0 — estrutura organizada para GitHub e Render

Este pacote contém as pastas Backend, Frontend, Banco de Dados, Cerebro e docs diretamente na raiz do repositório. O conteúdo de node_modules foi removido; o Render instalará a dependência do worker durante o build.

## Background Worker da NOVA BRAIN
- Build: `npm install --prefix Backend`
- Start: `node Backend/agent-runner.js --loop 15`
- Variáveis obrigatórias no Render: `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.

O `render.yaml` cria um Background Worker Node. Ele não substitui a hospedagem do Frontend; mantenha o site publicado no serviço atual (por exemplo, Netlify).

## Banco
Antes de esperar ações dos agentes, confirme no Supabase a aplicação da migração `Banco de Dados/Migracao-4-LUMINOVA-3x.sql` e do seed `Banco de Dados/Seed-agentes-NOVA-BRAIN.sql`, conforme a documentação do projeto. Faça backup antes de executar SQL em produção.
