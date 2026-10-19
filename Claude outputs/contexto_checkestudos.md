# Contexto do projeto — Direto à Posse (checkEstudos)

> Arquivo de conhecimento do Projeto. Atualize sempre que algo importante mudar (seção "Histórico de decisões" e "Backlog").

## 1. Produto
- **Nome:** Direto à Posse (pasta/repositório: `checkEstudos`).
- **O que é:** app web para organizar e acompanhar estudos para concursos públicos brasileiros: edital organizado em matérias/tópicos, cronômetro de estudo, histórico, flashcards com repetição espaçada, jogos de questões, estatísticas, análise de desempenho com IA e conquistas.
- **Usuária principal / dona do produto:** Ana. Planos de estudo atuais: ENAM e TRT (o app suporta vários "planos").
- **Idioma:** 100% português do Brasil (UI, mensagens, comentários).
- **Hospedagem:** Railway. Deploy a partir do GitHub (precisa commit + push para ir ao ar).

## 2. Stack e estrutura
- **Backend:** Node.js (>=20) + Express, ESM (`server.mjs`), MongoDB (driver nativo), autenticação com cookies/JWT, multi-usuário (todo dado filtrado por `userId`), socket.io, web-push, node-cron.
- **Front-end:** HTML + CSS + JavaScript puro (sem framework). Gráficos com Chart.js. Sem bundler: um único `app.js` grande com funções globais chamadas via `onclick="..."`.
- **Arquivos principais:**
  - `server.mjs` — todas as rotas da API e a lógica de negócio.
  - `public/index.html` — todas as telas (views) em um HTML só; troca de tela via `trocarView(nome)`.
  - `public/src/app.js` — toda a lógica do front.
  - `public/css/style.css` — estilos, com temas por variáveis CSS (claro/escuro + cores de destaque).
  - `public/jogo/` — mini-app dos jogos de questões (index.html, src, css próprios).
  - `scripts/build-js.mjs` — minifica JS com terser (gera `*.min.js`); CSS minificado via `cleancss`.
  - `package.json` — `prestart` roda o build automaticamente.
- **Variáveis de ambiente relevantes:** `API_CLAUDE` (chave da API Anthropic, usada pelas funções de IA). Nunca colocar segredos no código.

## 3. Modelo de dados (coleções MongoDB)
Usuários, edital (matéria/tópico/subtópicos com `concluido` e `planos`), planos, tiposEstudo, **sessões** (`inicio`, `fim`, `duracaoSegundos`, `plano`, `tipoEstudoNome`, `topicos[]` com `materia`/`topico`, `acertos`, `erros`, `paginasLidas`, `observacoes`, `revisao`), cores das matérias, jogo (pontuações/rodadas), **flashcards_baralhos** (`nome`, `caminho`, `materia`), **flashcards_cartoes**, **ia_uso_mensal** (tokens gastos por usuário/mês), **analises_desempenho** (última análise de IA por usuário).

## 4. Funcionalidades (visão geral)
- **Resumo:** cards de métricas, gráfico dos últimos 30 dias, tempo por matéria/tipo, ofensiva (streak 🔥).
- **Edital:** matérias → tópicos → subtópicos, marcação de concluído, vínculo a planos, importação/exportação, sugestão de edital a partir de PDF via IA (limite de 50 páginas, limite mensal de tokens).
- **Estudos:** cronômetro (livre e pomodoro), finalização de sessão (tópicos, acertos/erros ou páginas, observações, revisão agendada), histórico agrupado por dia com **total estudado no dia**, mostrando a **matéria** junto dos tópicos.
- **Flashcards:** baralhos em árvore (pastas/subbaralhos), tipos de cartão `basico`, `cloze` (omissão) e `vf` (Verdadeiro/Falso, com feedback verde/vermelho), campo "Observação" opcional estilizado (linha separadora + cinza), importação do Anki (.apkg) e de arquivo, exportação.
  - Editor rich-text (negrito, itálico, sublinhado, sobrescrito/subscrito, cor, realce, listas 1./a)/−, desfazer). Cores favoritas persistidas em `localStorage` (máx. 6 por tipo, a mais nova entra na frente). CSS neutraliza tamanhos de fonte colados de fora.
  - **Repetição espaçada (estilo SM2/Anki):** fases "aprendendo" (passos em minutos: `PASSOS_APRENDIZADO_MIN = [1, 10]`; relearning `[10]`) e "revisão" (dias, crescendo por fator de facilidade, inicia em 2.5). Botões Errei/Difícil/Bom/Fácil mostram o tempo real até a próxima revisão (`<1min`, `<4min`, `<2h`, `3 dias`...).
  - **Fila de revisão:** `filaRevisaoCache` (cartões não vistos, ordem original) + `filaAprendizadoCache` (cartões respondidos ainda em aprendizado). A cada próximo cartão, se algum da fila de aprendizado já venceu, ele entra na frente (intercala no meio do baralho); se só restarem cartões aguardando, aparece uma tela de espera com contagem que continua sozinha.
- **Jogo:** jogos de questões com pontuação e rodadas por dia.
- **Estatísticas:** gráficos por período (dia/semana/mês/intervalo) de matérias, jogos, planos e evolução.
- **Análise (IA):** aba com resumo numérico calculado no servidor (tempo e acerto por matéria, cartões mais difíceis, cobertura do edital, streak, revisões em dia) + textos gerados por Claude (pontos fortes / atenção / foco). Botão "Atualizar análise" com cooldown de 5 min e uso da cota mensal compartilhada de IA.
- **Conquistas** e **Configurações**.

## 5. Convenções de código
- Reaproveitar classes existentes: `painel-bloco`, `painel-bloco-header`, `painel-bloco-sub`, `painel-bloco-duas-colunas`, `dashboard-grid`, `stat-card*`, `chart-card`, `chart-card-canvas`, `estat-vazio`.
- Variáveis CSS: `--primary`, `--primary-dark`, `--primary-light`, `--card`, `--border`, `--text`, `--text-muted`, `--text-faint`, `--surface-muted`, `--success`, `--radius`, `--radius-sm`, `--shadow-sm`.
- Erros para o usuário: `alert(mensagem)` (padrão atual). HTML dinâmico: sempre `escaparHtml()` em texto de usuário.
- Gráficos: instâncias guardadas em `graficosEstatisticas` e destruídas com `destruirGraficoEstatistica(id)` antes de redesenhar; cores lidas com `corCssVar('--var', fallback)`.
- Rotas de API: `app.get/post(..., requireAuth, ...)`, sempre filtrando por `req.userId`.
- Mobile: breakpoint principal `@media (max-width: 600px)`; lista de baralhos no celular mostra o nome completo na 1ª linha e contagens (🆕 ⏳ 🔁) + ações na 2ª.
- IA: `fetch('https://api.anthropic.com/v1/messages')` com `x-api-key: process.env.API_CLAUDE`, modelo `claude-haiku-4-5`, saída estruturada via `tools` + `tool_choice`; registrar uso com `registrarUsoIa`; checar cota com `tokensIaUsadosNoMes` vs `LIMITE_TOKENS_IA_MENSAL` (380.000 tokens/mês por usuário).

## 6. Build, cache e deploy (importante)
- Em produção o site serve versões **minificadas** (`app.min.js`, `style.min.css`), geradas por `npm run build`, que roda automaticamente no `prestart`/deploy.
- O terser faz mangle de nomes de topo. O `scripts/build-js.mjs` extrai todo identificador usado em atributos `onclick/onchange/oninput/onload/onmousedown/onmouseup/onkeyup/onfocus` (HTML e strings de template do JS) e os protege. **Bug já ocorrido:** só funções eram protegidas, então `onclick="iniciarRevisao(baralhoAtualId)"` quebrava com "baralhoAtualId is not defined" em produção. Corrigido protegendo qualquer identificador solto.
- Cache-busting de assets via `VERSAO_ASSETS`.
- Checklist ao entregar mudança: validar sintaxe → commit → push → deploy (Railway) → testar no site (limpar cache se necessário).

## 7. Fluxo de trabalho com a Ana
- Ela descreve problemas/ideias em linguagem natural, muitas vezes com prints. Investigar causa raiz antes de corrigir.
- Features grandes: primeiro um desenho/mockup e confirmação; depois implementação.
- Entregar arquivos completos nos caminhos reais do repositório e dizer o que testar.
- Ela costuma testar no celular (tema escuro) e no desktop.

## 8. Histórico de decisões (resumo)
- Cartão de omissão (cloze) tem campo extra renomeado para **"Observação"**, exibido com linha separadora e texto cinza.
- Tempos exibidos nos botões de revisão são precisos (não existe mais o genérico "<10min").
- Cartões errados reaparecem na mesma sessão, intercalados por tempo (duas filas), em vez de só no fim.
- Fonte padronizada nos cartões/observações via CSS (`font-size: inherit !important`, mantendo sup/sub menores).
- Lista de baralhos no celular: ícones 🆕/⏳/🔁 em vez de siglas, nome completo sem reticências.
- Análise de desempenho com IA usa só dados numéricos agregados (nunca texto livre do usuário) e compartilha a cota mensal de tokens com a importação de edital por PDF.
- Histórico de estudos mostra matéria + total do dia.

## 9. Backlog / ideias futuras
- **Acesso direto ao GitHub:** criar token fine-grained (apenas repo `checkEstudos`, permissão Contents: Read and write, com validade) para permitir atualizações sem depender do PC ligado.
- Evoluir a Análise (recomendações por prazo de prova, comparação semana a semana, alertas de matérias esquecidas).
- Planos pagos / cotas maiores de IA no futuro (hoje o app é gratuito com cota mensal).
- Testes automatizados mínimos para a lógica de repetição espaçada e para o build.

## 10. O que NÃO fazer
- Não reordenar a fila de revisão inteira por `dataProximaRevisao`.
- Não usar cores fixas onde existe variável de tema.
- Não colocar chaves/segredos no código ou em arquivos versionados.
- Não assumir que um bug em produção é do código antes de checar se o deploy/build rodou.
