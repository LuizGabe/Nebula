# Nebula — sistema visual e biblioteca, etapas 1, 2 e 3

## Escopo

A etapa 1 entregou a fundação compartilhada para login, biblioteca, configurações, nova sessão, sessão e status, preservando APIs, schema, geração, templates, IndexedDB e locks. A etapa 2 reorganiza a biblioteca e acrescenta cor persistida aos cadernos e resumo de processamento à listagem. Aulas e reuniões têm o mesmo peso; conflitos de fluxo priorizam reuniões. Nenhuma das etapas inclui notas pessoais, perguntas durante captura ou nova arquitetura de conteúdo.

## Temas

- Primeiro acesso: escuro, independentemente do sistema operacional.
- Preferência válida: `nebula:theme` em localStorage, valores `dark` e `light`.
- `index.html` aplica `data-theme`, `color-scheme` e fundo antes de importar React. Preferência inválida ou armazenamento indisponível usa escuro.
- `store/appearance.ts` atualiza a raiz sem remontar layout, editor ou captura e acompanha alterações em outras abas. Falha ao persistir não impede os controles.
- Recolhimento desktop: `nebula:sidebar-collapsed`. Drawer mobile é transitório e independente.
- Persistência local não implica sincronização com a conta ou outros dispositivos.

## Tokens

Valores RGB em `src/index.css`, integrados ao Tailwind e compatíveis com opacidade. Usar nomes semânticos nas telas; não redefinir globalmente utilitários como `bg-white`.

| Token | Escuro | Claro | Uso |
|---|---|---|---|
| canvas | #111214 | #F6F7F9 | Fundo |
| sidebar | #17181C | #EDEFF4 | Navegação |
| surface | #202228 | #FFFFFF | Documento, painel, diálogo |
| muted | #1A1C21 | #F2F3F7 | Agrupamentos |
| hover | #2B2E36 | #E6E8F0 | Hover e skeleton |
| primary | #ECEEF2 | #202228 | Conteúdo e títulos |
| secondary | #B7BDC8 | #4C5360 | Texto secundário |
| text-muted | #A5ABB6 | #5C6370 | Metadados e placeholders |
| line | #40444F | #D2D6E1 | Divisórias |
| control-line | #707889 | #7E8696 | Limite dos campos e switches |
| focus | #B9A9FF | #684CBE | Foco e identidade |
| selection | #40355E | #E8E1FA | Seleção |
| action | #A99AF5 | #674CB8 | Ação preenchida |
| action-hover | #C0B4FF | #5439A1 | Hover da ação |
| on-action | #161223 | #FFFFFF | Texto sobre ação |
| overlay | Preto com opacidade | Preto com opacidade | Sobreposição |

A classe `text-subtle` usa `--text-muted`; `bg-muted` usa `--muted`. Não usar `text-muted`: o nome corresponde à superfície no Tailwind.

Estados: famílias jade (sucesso), amber (espera/atenção), rose (erro/captura), blue/sky (informação), com superfície, borda e texto por tema. Botão danger usa `--danger-fill` e `--danger-ink` próprios. Estado essencial precisa de texto ou ícone além da cor.

Cadernos: tokens reservados `--notebook-violet/sage/sand/blue`. Seleção e persistência são implementadas na etapa 2; concentrar cor em ícones, marcadores e seleção. Participantes: `--speaker-1…4`, separados de identidade e estado. O SVG da marca mantém cores próprias.

Aliases ink permanecem para compatibilidade pontual; código novo usa tokens semânticos. SVGs operacionais e waveform acompanham tema. WaveSurfer recebe novas cores por `setOptions` sem recriar player ou áudio.

## Tipografia e composição

- Sistema: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif. No Windows: Segoe UI.
- Código/tempos: Cascadia Code, Consolas, monospace. Interface sem fontes externas.
- Escala curta: 12 px metadados; 14 px navegação/controles; 16 px destaque; 18–20 px seções; 24 px títulos.
- Documento com entrelinha confortável, próxima de 1,75. Não apagar parágrafos para criar hierarquia.
- Espaçamento de composição: múltiplos de 4 px (4, 8, 12, 16, 24, 32); meios passos só para alinhamento óptico de controles.
- Raios: 8 px controles, 12 px menus/agrupamentos, 16 px painéis/player, 24 px diálogos. Pílulas reservadas para badges/switches.
- Navegação: Lucide 18 px, traço 1,75. Ações locais: 16–20 px.

## Materiais e movimento

Leitura e formulários opacos. Navegação e player podem usar translucidez leve, com fundo opaco sem backdrop-filter. Sem gradientes atrás de documentos, brilho contínuo ou animação que pareça tráfego medido.

Hover/abertura: aproximadamente 120–160 ms. Spinner/skeleton comunicam atividade. O pipeline usa texto e ícones. `prefers-reduced-motion` contém somente redução de movimento; layout é idêntico com a preferência ligada ou desligada. Waveform reduz frequência de atualização.

## Componentes

- Button: primary, secondary, ghost, danger; sm/md/lg. Loading desabilita e expõe aria-busy.
- IconButton: label obrigatório, tooltip por hover/foco; alvo de 36 px, ampliado em toque.
- Input: label associado, placeholder legível, aria-invalid e erro vinculado. Campos locais preservados usam os mesmos tokens.
- Badge: estado textual acompanhado de cor.
- Toggle: switch com aria-checked, label e posição do indicador.
- Segmented: aria-pressed, contorno e superfície; compartilhado em configurações e nova sessão.
- MenuSurface: foco inicial, setas/Home/End, Escape, fechamento externo e restauração ao acionador.
- Skeleton/Spinner: status acessível no contexto.
- PipelineStatus: pendente, aguardando, em andamento, concluído e falhou; sem pulsação decorativa.

Markdown: `.nebula-markdown`; tabelas com rolagem própria. Milkdown/Crepe preserva o editor e sobrescreve suas variáveis públicas: fundo, texto, menus, hover, seleção, código e fontes. Não introduzir outro editor para reproduzir o visual.

## Navegação e camadas

Sidebar: 248 px expandida, 64 px recolhida; variável `--sidebar-width` compartilhada com o player. Marca abre biblioteca; Nova sessão é principal; biblioteca/cadernos acima; configurações/status/tema/conta/saída abaixo. Recolher esconde a árvore sem desmontar, preservando rascunhos e expansão. Ações mantêm nomes acessíveis e tooltips.

Mobile: barra com acionador, drawer independente, fechamento após navegação/Escape/clique externo, foco contido/restaurado e conteúdo principal inerte. Conta aponta à seção existente `/settings?section=account`. Sem nova busca global ou página de templates.

`Sem caderno` representa folderId nulo; `folder=root` permanece interno. Hierarquia, ações e arraste foram preservados. Player usa largura real da sidebar e deslocamento zero no mobile. Conteúdo mantém reserva inferior; tabelas/filas/diagramas contêm rolagem.

| Camada | Valor |
|---|---:|
| Menu | 20 |
| Aviso de captura | 30 |
| Player/atalho recuperação | 40 |
| Backdrop/drawer mobile | 49/50 |
| Diálogo/perguntas | 60 |
| Tooltip | 70 |

Recuperação usa dialog.showModal(), na camada superior nativa. `useDialogFocus` mantém uma pequena pilha dos diálogos customizados: só o superior trata foco/Escape. Com dialog nativo aberto, a responsabilidade fica com o navegador. Exclusão de caderno usa portal fora da sidebar. Evitar novos stacking contexts no editor sem revisar seus menus.

## Captura e rascunhos

AudioRecorderService continua fora do React; IndexedDB, fragmentos, manifesto e locks são preservados. Tema/recolhimento não chamam start/stop nem remontam editor. Não usar keys de tema/sidebar/rota para reinicializar componentes.

Reconhecimento do navegador ainda pertence à tela e pode parar ao sair. CaptureNavigationGuard oferece permanecer antes de navegação interna ou voltar/avançar nessa modalidade. O áudio não é parado silenciosamente. Recarregar/fechar durante captura ativa usa aviso de saída do navegador. Isso não garante reconhecimento entre telas nem rascunhos após recarga.

## Validação e limites

Comandos na raiz:

- `pnpm --filter nebula-frontend build`
- `pnpm --filter nebula-frontend exec tsc --noEmit`
- `pnpm --filter nebula-frontend test:transcript`
- `pnpm --filter nebula-frontend exec node tests/runTranscriptInteraction.mjs tests/appearanceNavigation.test.tsx`
- `node --test apps/web/tests/browserSpeech.test.cjs apps/web/tests/documentReprocess.test.cjs apps/web/tests/audioDuration.test.cjs apps/web/tests/youtube.test.cjs`
- `pnpm --filter api exec tsx ../web/tests/recordingRecovery.test.ts`
- `pnpm --filter api exec tsx ../web/tests/markdown.test.tsx`

A regressão de aparência verifica bootstrap, armazenamento inválido/indisponível, persistência, nó de edição/snapshot da captura preservados, recusa de navegação e foco/Escape mobile. Happy DOM não comprova geometria, contraste renderizado ou hardware.

Na execução da etapa 1 não havia navegador/aba acessível. Antes de aprovar visualmente: revisar ambos os temas em desktop/mobile, sidebar expandida/recolhida, editor/menus, diálogos concorrentes, recuperação nativa e player. Não houve deploy.

Etapa 2: biblioteca/organização, persistência de cor por caderno e revisão de escopos/estados. A arquitetura de templates permanece para a próxima etapa. Permanecem pendentes as inconsistências de padrão/permissões de templates no backend, a continuidade integral do reconhecimento entre telas e rascunhos textuais persistidos. Não foram apresentados como capacidades novas.

### Resultado da execução

Build e tipos do frontend, interação da transcrição, aparência/navegação, reprocessamento, reconhecimento do navegador (oito cenários), duração, YouTube, recuperação local (cinco cenários) e Markdown passaram. A regressão de aparência também verifica contraste numérico de 54 pares de texto/fundo, limites de campos, foco de menus e diálogos concorrentes. Isso não substitui auditoria visual em navegador. O build mantém avisos de bundle grande e base Browserslist antiga; dependências não foram atualizadas.


## Etapa 2 — biblioteca e cadernos

### Composição e navegação

A entrada tem título Biblioteca, busca por título/template com escopo explícito e ações Novo caderno/Nova sessão. Uma única lista inclui todas as sessões carregadas, inclusive as organizadas em cadernos; não há métricas, painel de atenção, recentes duplicados ou alternância para cards. A ordem é criação decrescente, descrita como “Mais recentes · por criação”. Datas completas incluem ano e horário, em pt-BR, no fuso local do navegador, preservando a convenção anterior do app. Não representam último acesso.

Os cadernos de primeiro nível formam uma seção compacta com ícone, nome e total de sessões não excluídas no ramo. Sem caderno é um destino válido, sempre disponível na visão geral; inclui exclusivamente folderId nulo. Dentro de um caderno: breadcrumb navegável pela hierarquia real, nome/cor, edição, Novo subcaderno e Nova sessão com destino selecionado. Os subcadernos diretos ficam separados da lista recursiva de sessões. Um texto explica a inclusão dos descendentes. URL `?folder=<id>` e histórico continuam sendo a fonte de escopo; um caderno removido apresenta estado indisponível, sem cair silenciosamente na visão geral.

Busca ignora acentos e caixa, restrita a título e nome do template. Escopos: biblioteca inteira carregada, ramo atual ou somente Sem caderno. Durante a busca a seção de navegação por cadernos é ocultada. Não há busca em conteúdo, busca semântica ou filtros decorativos.

As sessões são linhas com divisórias discretas e superfícies neutras. O título completo pode quebrar linhas; caminho, data/hora e template são secundários. O link de abertura fica separado de Organizar/Mover para, um select nativo disponível por teclado e toque, além do arraste existente. Os metadados se empilham no mobile. O layout compartilhado aplica flex somente a partir de md; uma utility flex incondicional sobrepunha o bloco mobile definido na camada de componentes.

### Cor persistida

`folders.color` armazena um identificador: neutral (Padrão), violet (Violeta), sage (Sálvia), sand (Areia) ou blue (Azul). POST/PUT validam com Zod, preservando os checks de proprietário, e GET normaliza ausências/valores desconhecidos para neutral. O frontend também usa fallback seguro e só resolve tokens conhecidos; não aceita CSS ou hex livres. Subcadernos não herdam cor do pai. A cor aparece em ícones e detalhes, nunca preenche a superfície de leitura.

O diálogo compartilhado NotebookDialog atende criação/edição pela biblioteca e sidebar. Opções têm nomes, aria-pressed, contorno e check de seleção. Salvamento informa progresso e erro, evita envio repetido e bloqueia fechamento enquanto pendente. Escape, contenção e restauração de foco usam useDialogFocus; no mobile o drawer permanece sob o diálogo. O painel limita altura ao viewport e pode rolar.

Migração: `ALTER TABLE "folders" ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT 'neutral';`. Incluída no bootstrap SQL e na rotina isolada ensureFolderColorSchema, executada na inicialização da API antes de servir requisições. É aditiva e repetível; não muda IDs, hierarquia ou associações. Para aplicar apenas essa mudança manualmente, execute essa instrução SQL no banco desejado; não é necessário executar o bootstrap completo, que contém evoluções históricas fora deste escopo. O schema Prisma continua sendo a fonte do modelo; gerar o cliente não altera o banco.

Nesta execução a coluna foi aplicada e verificada no PostgreSQL de desenvolvimento local. A API local foi reiniciada para carregar o código atualizado. Não houve reset de banco, migração destrutiva ou deploy.

### Estados e atualização

Captura/sessão, transcrição e documento são apresentados separadamente. ACTIVE significa “Sessão aberta”, sem afirmar que o microfone está gravando. ENDED significa “Sessão encerrada”; nunca prova existência de documento. A resposta da biblioteca acrescenta somente processing: existência de documentos/transcrições persistidos, contagem de áudios pendentes/falhos e último evento de documento. Prisma busca relações em lotes, sem consultas individuais por sessão, textos de transcrição ou payloads de eventos. A máquina de processamento e a reconciliação preexistente não mudaram.

Documento disponível exige registro persistido. Eventos de fila, geração, falha e geração ignorada têm precedência sobre esse rótulo; quando aplicável, o texto informa que existe documento anterior. “Transcrição disponível” indica existência de texto persistido, não certifica completude. A ausência de evidência usa rótulos conservadores. Pendências de áudio e sessões IN_PROGRESS ativam verificação a cada 15 segundos, somente com a página visível, sem requisições sobrepostas. O ciclo para quando não há pendências e desmonta ao sair. O evento nebula:sessions-changed continua atualizando os dados; um evento durante uma requisição agenda nova leitura após ela terminar. Não há promessa de atualização instantânea.

Atualizações preservam nós das linhas, query, foco e posição de leitura; skeletons só aparecem no carregamento inicial. Erro mantém os dados anteriores e oferece nova tentativa. Há estados distintos para biblioteca vazia, ramo vazio, Sem caderno vazio e busca sem resultado. A exclusão pela sidebar explica a abrangência sobre descendentes e oferece preservar as sessões em Sem caderno ou excluir também as sessões. A contagem recursiva do aviso não duplica sessões dos filhos.

### Verificação da etapa 2

- API e frontend: builds TypeScript; build Vite do frontend.
- Prisma: validate e generate.
- `pnpm --filter api exec tsx tests/folders.integration.ts`: PostgreSQL local, duas contas isoladas, persistência e leitura de cor, fallback legado, repetição da instrução aditiva, validação, autorização, independência da cor dos filhos e as duas intenções de exclusão recursiva. O teste remove somente seus registros temporários ao terminar.
- `node --test apps/api/tests/youtubeSessions.test.cjs`: também verifica o resumo mínimo de listagem, propriedade, exclusão lógica e ausência de transcrições/payloads na resposta.
- `node apps/web/tests/runTranscriptInteraction.mjs tests/library.test.tsx --dom`: regras de escopo/ordem, acentos, breadcrumbs, histórico, criação no destino, estados conservadores, mover sem arraste, paleta acessível, busca/foco/posição estáveis durante atualização, controle de concorrência, erros e vazios. --dom inicializa o ambiente antes de react-dom para testar eventos de input em componentes com portal.
- Regressões de aparência/navegação, interação de transcrição e geração de documentos preservadas.

Inspeção em navegador local: biblioteca desktop 1440×1000 e mobile 390×844 em ambos os temas; ausência de overflow horizontal no mobile; cadernos aninhados/breadcrumbs e voltar; destino selecionado no modal Nova sessão sem criar sessão; paleta e Escape; drawer sob o diálogo. As ações de dados reais foram canceladas. Persistência e exclusão foram testadas com contas isoladas no PostgreSQL. Capturas locais fora do Git: library-desktop-dark.jpg, library-desktop-light.jpg, library-mobile-dark.jpg, library-mobile-light.jpg e notebook-palette-light/mobile.jpg, na pasta de visualizações desta conversa.

Pendência para a próxima etapa: permissões e padrão pessoal de templates; a inicialização/listagem atual ainda pode repor os templates nativos. Esta entrega não promete corrigir essa arquitetura. Permanecem os avisos já existentes de bundle grande e base Browserslist antiga.

Resultado final da etapa 2: builds de API e frontend, Prisma validate/generate, integração PostgreSQL, listagem/YouTube, biblioteca, aparência/navegação, transcrição e documentGeneration passaram. A inspeção mobile confirmou Escape e restauração ao acionador Novo caderno após o diálogo de cores. Dados temporários de QA foram removidos.


## Etapa 3 — templates e criação progressiva

A política completa, migração, comportamento dos legados e comandos de teste estão em [template-policy.md](template-policy.md). A pendência de permissões e padrão pessoal registrada na etapa 2 foi resolvida nesta etapa: listagem sem escrita, identidade estável da plataforma, capacidades efetivas, padrão por conta e exclusão lógica com referências preservadas.

- **ConfirmDialog:** portal na camada de diálogo, título acessível, cancelamento seguro como primeiro foco, ações explícitas, contenção/Escape/restauração pelo useDialogFocus. Substitui confirmações nativas do gerenciamento e descarte; o aviso de fechamento/recarregamento da janela permanece nativo por exigência do navegador.
- **TemplateManager:** grupos Da plataforma, Meus templates, Compartilhados e política identificada de legado sem proprietário. Seleção por botão separado de duplicar/padrão/excluir. Lista com altura limitada e rolagem própria; abas de Configurações em linha rolável no mobile. Conteúdo readonly mantém contraste; readonly não equivale a texto apagado.
- **TemplateOptionsFields:** agrupamentos compartilhados de estilo, estrutura, referências e tipo de transcrição, com Segmented/Toggle existentes. Nome, descrição e instruções têm labels associados, limites e contadores.
- **Nova sessão:** diálogo de uma coluna, até 576 px, superfície neutra, altura limitada ao viewport e rolagem interna. Fonte, template com descrição/origem, título, destino compacto com caminho/cor e dois details fechados inicialmente: Contexto e Ajustes desta sessão. Sem coluna permanente para árvore de cadernos.
- **Herança:** resumo Do template/Personalizado; campos não alterados seguem por referência. Restaurar ajustes é explícito. TemplateSwitchDialog oferece Manter ajustes, Usar valores do novo template e Cancelar; instruções específicas são descritas como substituição das instruções do template.
- **Envio:** rótulos Continuar para gravação / Continuar para envio / Importar vídeo. A espera bloqueia controles e fechamento, com status textual. Erros de consulta, vazio, destino indisponível e criação são distintos; retry de consulta preserva campos. Um sessionId em uma falha de importação oferece acesso à sessão existente e impede repetir a criação.
- **Rascunho:** useDraftGuard protege troca de template, seção, rota, histórico e saída. Gerenciar a partir da criação preserva a instância, sinaliza o rascunho suspenso e oferece Voltar à nova sessão. Novas leituras não redefinem ajustes. Nada é apresentado como recuperação do rascunho após recarga.

Inspeção real e QA visual cobriram desktop/mobile nos dois temas, ajustes expandidos, controles readonly, falhas e diálogos sobrepostos. O tooltip de fechamento fica alinhado à borda direita do diálogo para não transbordar no mobile. A página local de QA usa dados claramente simulados e não altera contas ou sessões reais. Capturas e limitações estão documentadas na política da etapa 3.
