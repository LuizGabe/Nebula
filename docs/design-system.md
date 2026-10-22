# Nebula — sistema visual, etapa 1

## Escopo

Fundação compartilhada para login, biblioteca, configurações, nova sessão, sessão e status. Aulas e reuniões têm o mesmo peso; conflitos de fluxo priorizam reuniões. Esta etapa preserva APIs, schema, geração, templates, IndexedDB e locks. Não inclui notas pessoais, perguntas durante captura ou nova arquitetura de conteúdo.

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

Cadernos: tokens reservados `--notebook-violet/sage/sand/blue`. Seleção e persistência ficam para a etapa 2; concentrar cor em ícones, marcadores e seleção. Participantes: `--speaker-1…4`, separados de identidade e estado. O SVG da marca mantém cores próprias.

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

Nesta execução não havia navegador/aba acessível. Antes de aprovar visualmente: revisar ambos os temas em desktop/mobile, sidebar expandida/recolhida, editor/menus, diálogos concorrentes, recuperação nativa e player. Não houve deploy.

Etapa 2: biblioteca/organização, persistência de cor por caderno, revisão de escopos/estados e templates. Permanecem pendentes as inconsistências de padrão/permissões de templates no backend, a continuidade integral do reconhecimento entre telas e rascunhos textuais persistidos. Não foram apresentados como capacidades novas.

### Resultado da execução

Build e tipos do frontend, interação da transcrição, aparência/navegação, reprocessamento, reconhecimento do navegador (oito cenários), duração, YouTube, recuperação local (cinco cenários) e Markdown passaram. A regressão de aparência também verifica contraste numérico de 54 pares de texto/fundo, limites de campos, foco de menus e diálogos concorrentes. Isso não substitui auditoria visual em navegador. O build mantém avisos de bundle grande e base Browserslist antiga; dependências não foram atualizadas.
