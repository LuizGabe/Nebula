# Nebula — contexto de produto, telas e regras para redesign

Levantamento em 22/10/2026, baseado no código do frontend e das rotas do backend. Este documento descreve a implementação encontrada; sugestões estão identificadas como oportunidades, não como funcionalidades existentes. Não houve inspeção visual do app em execução nem validação dos serviços implantados. Dados, modelos disponíveis e configuração de infraestrutura variam por ambiente.

## 1. Briefing para a IA de design

O Nebula transforma áudio de reuniões, aulas e outros conteúdos em transcrições consultáveis e documentos gerados por IA. O usuário pode gravar pelo microfone, enviar arquivo ou importar vídeo do YouTube; organizar sessões em cadernos e subpastas; escolher um template; consultar o áudio junto do texto; editar documentos; fazer perguntas e extrair insights.

O objeto central é a **sessão**, que reúne fonte de áudio, transcrição, template, contexto, configurações específicas, documentos e eventos de processamento. O resultado não chega de uma só vez: captura, envio, transcrição e geração de documento têm estados distintos. Uma boa interface precisa deixar claro o que foi salvo, o que está acontecendo, o que pode falhar e o que o usuário pode fazer em cada momento.

Públicos sugeridos pelos textos e templates existentes: pessoas que acompanham aulas, estudam, registram reuniões, organizam material por turma/tema/cliente e transformam conversas em material de consulta ou planos de ação. Isso é uma inferência do produto; não há pesquisa de usuários ou personas validada neste levantamento.

Objetivo do redesign: reduzir esforço para criar e reencontrar sessões, tornar a personalização compreensível e transmitir confiança no processamento e na preservação do áudio. Manter o vínculo entre resultado gerado e fonte original.

## 2. Vocabulário e entidades

| Termo | Significado atual | Consequência para o design |
|---|---|---|
| Sessão | Unidade de trabalho com áudio, transcrição e documentos | É o destino principal após criar/importar |
| Caderno / pasta | Mesma entidade de organização, com hierarquia por pasta pai | A interface mistura os dois nomes; padronizar |
| `/root` | Sessões com `folderId = null` | É um agrupamento virtual, não uma pasta persistida |
| Template / prompt | Registro no banco que orienta a geração do documento | Configurações usa “template”; nova sessão usa “prompt” |
| Contexto | Informação sobre aquela sessão: objetivo, turma, cliente etc. | Deve ser distinguido de instruções de escrita |
| Instruções | Como transformar a transcrição em documento | Podem vir do template ou da substituição na sessão |
| Modelo LLM | Modelo de geração de documentos e respostas | Preferência da conta; não é o motor de transcrição |
| Motor de transcrição | Serviço de reconhecimento da fala, com possibilidade de fallback do navegador | Disponibilidade e experiência diferem do LLM |
| Documento | Texto em Markdown, com versões e edição | Não confundir conclusão da sessão com existência de documento |
| Insights | Resumo, tarefas, tags e tom do texto | Resultado separado, gerado/atualizado por ação própria |

## 3. Navegação e estrutura global

Rotas existentes:

- `/login`: entrar ou cadastrar, fora do layout autenticado.
- `/`: dashboard/biblioteca.
- `/?folder=<id>`: biblioteca no escopo de um caderno, incluindo sessões de descendentes.
- `/?folder=root`: apenas sessões sem caderno.
- `/sessions/:id`: espaço de trabalho da sessão.
- `/settings`: configurações.
- `/status`: status operacional autenticado.
- Caminhos desconhecidos redirecionam para `/`.

O layout autenticado tem barra lateral, conteúdo principal, aviso de gravação ativa, recuperação de gravações e modal global de nova sessão. Na barra lateral há marca, links Sessões/Configurações/Status, ação Nova sessão, organização por pastas e identificação/saída da conta.

A marca (ícone e nome juntos) agora é um link para `/`. Remove o filtro de pasta da URL e fecha a navegação mobile ao clicar, inclusive quando o caminho já é `/`. Possui nome acessível e foco visível. O botão de menu mobile permanece separado do link.

A sidebar é uma coluna de 256 px no desktop. Abaixo de 768 px passa a ocupar a largura e usa expansão/recolhimento da navegação. Mudanças de caminho ou query fecham o menu mobile. A árvore tem pastas/subpastas e sessões; pastas são ordenadas por nome e sessões por criação decrescente. Usuários podem criar pastas/subpastas, renomear, excluir e arrastar sessões para uma pasta ou para `/root`.

Excluir pasta oferece duas intenções: preservar as sessões movendo-as para `/root`, ou excluir também as sessões do conjunto afetado. O backend percorre descendentes para aplicar a decisão às sessões. O redesign deve comunicar a abrangência da operação, preservar a alternativa de salvar o conteúdo e não depender apenas de ícones ou hover. Ações de pasta atualmente ficam mais discretas até passar o mouse.

## 4. Dashboard inicial — `/`

### Estrutura atual

Cabeçalho “Sua biblioteca”, texto sobre conversas/ideias/documentos e botão Nova sessão. A visão geral contém quatro indicadores:

| Indicador | Cálculo real |
|---|---|
| Sessões | Quantidade de sessões retornadas para o usuário |
| Processando | Sessões com status `IN_PROGRESS` |
| Cadernos | Todas as pastas, incluindo subpastas |
| Prontas | Sessões com status `ENDED` |

Um painel “Pontos que merecem atenção” aparece se houver sessões ativas, áudio em processamento ou sessões em `/root`. Exibe quantidades em texto; não funciona como um conjunto de filtros interativos. Estar sem caderno é tratado visualmente como motivo de atenção, embora seja um destino válido de criação.

“Continuar de onde parou” mostra as quatro sessões mais recentes **por criação**, não por último acesso ou edição. Os cards exibem título, data/hora em português, nome do template, status e texto de apoio. Clicar abre a sessão. Sem título, usa `<nome do template> sem titulo`.

A seção Cadernos lista pastas de primeiro nível e, quando há sessões sem pasta, uma linha `/root`. Cada linha mostra quantidade de sessões do ramo inteiro, quantidade de subpastas diretas e data da sessão criada mais recentemente no ramo. Tem ações Abrir e Nova sessão neste caderno.

A última seção mostra “Sessões sem caderno” quando não há busca. Ao digitar, vira “Resultados da busca” e procura em todas as sessões carregadas. Busca por título e nome do template, ignorando maiúsculas/minúsculas; não busca no texto da transcrição e não remove acentos. Não há paginação no endpoint atual: a lista é carregada inteira e filtrada no navegador.

### Dentro de um caderno

O cabeçalho passa a mostrar nome e total de sessões daquele ramo. O caminho de retorno “Sessões / nome” leva à visão geral. Métricas, atenção e recentes deixam de aparecer. São listadas subpastas diretas e sessões do caderno **incluindo descendentes**. A busca fica limitada ao ramo. Nova sessão herda a pasta selecionada. Em `/root`, considera apenas sessões sem pasta e não há subpastas.

### Estados e significados

- Carregamento inicial: seis skeletons de cards.
- Falha ao carregar: mensagem e botão Tentar novamente.
- Sem cadernos: orienta criar estrutura pela barra lateral.
- Sem sessões: mensagem e CTA Nova sessão.
- Busca sem resultado: sugere outro título/template e ainda oferece Nova sessão.
- `ACTIVE` aparece como “Ativa”, em rosa.
- `IN_PROGRESS` aparece como “Transcrevendo”, em âmbar, mesmo podendo ainda estar aguardando processamento.
- `ERROR` aparece como “Erro”, em rosa.
- Demais estados recebem “Pronta”, em verde; o contador Prontas verifica especificamente `ENDED`.

**Ressalva importante:** `ENDED` não garante que o documento foi gerado com sucesso. A API também reconcilia certas sessões em processamento para encerradas com base em eventos de transcrição/documento, inclusive documento ignorado ou falho. O redesign deve separar estado da sessão, transcrição e documento.

O dashboard carrega ao montar e escuta o evento local `nebula:sessions-changed`. Não há polling ou assinatura própria de status em tempo real na biblioteca; não prometer atualização contínua sem implementação adicional.

### Oportunidades de usabilidade

- Tornar óbvio o escopo da busca e a diferença entre recentes, sessões sem caderno e conteúdo de um ramo.
- Evitar tratar uma sessão válida sem pasta como problema operacional.
- Permitir criar caderno no contexto da biblioteca, em vez de explicar que a ação está na sidebar.
- Avaliar valor das métricas frente à tarefa principal de retomar/criar uma sessão.
- Diferenciar contagem de subpastas diretas e sessões recursivas.
- Reduzir repetição de cards entre recentes e sessões sem pasta.
- Se “Continuar” for mantido, definir se deve representar último acesso, atualização ou criação.

## 5. Configurações — `/settings`

Cabeçalho “Configurações”, subtítulo “Templates, modelo e conta”. Navegação interna com Templates, Modelo, Guia e Conta. Templates abre por padrão. A seção é estado local: não há subrotas nem query para compartilhar diretamente uma aba; remontar a página retorna ao padrão. No desktop, menu interno de 200 px e painel de conteúdo; em telas menores os blocos se empilham.

### 5.1 Templates

Lista e formulário ficam lado a lado em telas largas. Cada item mostra nome, Padrão/Personalizado e Público/Privado; há ações editar e remover. “Novo” limpa o formulário. Clicar em um template preenche o formulário de edição. Não há indicador de alterações pendentes nem proteção para trocar de item/aba e perder o rascunho.

Campos e valores:

| Campo | Opções, padrão e limite |
|---|---|
| Nome | Obrigatório; backend aceita 1–80 caracteres após trim |
| Descrição | Opcional, até 500 caracteres |
| Modo de transcrição | Reunião (`MEETING`) ou Aula (`CLASS`); padrão Reunião |
| Formalidade | Informal, Neutra, Formal; padrão Neutra |
| Detalhamento | Conciso, Equilibrado, Detalhado; padrão Equilibrado |
| Título principal | Ligado por padrão |
| Seções | Ligado por padrão |
| Subseções | Ligado por padrão |
| Preferir listas | Ligado por padrão |
| Preferir tabelas | Desligado por padrão |
| Referências de áudio | Ligado por padrão |
| Instruções adicionais | Obrigatórias para salvar; até 8.000 caracteres |
| Padrão para novas sessões | Desligado em um novo rascunho |
| Público | Desligado em um novo rascunho |

Salvar cria ou atualiza, apresenta loading e, no sucesso, limpa o formulário e recarrega a lista. Cancelar aparece na edição. Nome e instruções vazios desabilitam salvar. Limites de tamanho existem no backend, mas o formulário atual não oferece contadores nem os mesmos limites explícitos nos controles.

Excluir usa confirmação nativa do navegador. Backend impede remover o último template visível e tenta eleger outro quando o removido era padrão. O fluxo de exclusão atual não tem o mesmo tratamento visual de erro do salvamento.

**Visibilidade não equivale a permissão de edição:** a listagem retorna templates públicos ou pertencentes ao usuário. O backend bloqueia editar/excluir templates com outro proprietário; templates sem proprietário podem ser alterados/removidos por usuários autenticados. A UI mostra editar/remover para todos os itens, portanto uma ação pode terminar em 403.

**Comportamento atual que precisa ser conhecido antes de redesenhar:** `GET /prompts` executa `ensureDefaultDocumentTemplates()`. Essa rotina repõe/atualiza templates nativos por nome e força “Briefing executivo” como padrão, retirando o padrão de todos os demais. Assim, personalizar um template nativo ou escolher outro padrão pode ser desfeito ao recarregar a listagem. Além disso, a lógica de marcar padrão atua sobre registros públicos/visíveis; não é uma preferência isolada por usuário. Isso é uma inconsistência da implementação, não uma experiência desejável a reproduzir.

Templates nativos encontrados: Briefing executivo, Artigo estruturado, Guia passo a passo, Plano de ação, Material de estudo, Mapa de ideias e Roteiro multiformato. Não confundir essa lista de inicialização com o conteúdo garantido em todo ambiente.

### 5.2 Modelo

Define o LLM padrão da conta, usado para documentos e perguntas. A tela busca catálogo e recebe disponibilidade por SSE. Mostra seletor, disponibilidade e Salvar; após sucesso, feedback “Salvo” por dois segundos.

Só modelos considerados online aparecem. Groq é aceito enquanto não houver status explicitamente offline; outros provedores exigem confirmação positiva. Se o modelo salvo ficar offline, há aviso, a seleção pode ser limpa e o usuário precisa escolher outro. Sem modelos online, seletor e salvamento ficam indisponíveis. Falha ao salvar aparece em alerta; falha na busca do catálogo é tratada silenciosamente.

A tela não configura chave de API, endereço do provedor, motor de fala, idioma, tema ou notificações. Não apresentar esses recursos como existentes. Não confundir o modelo escolhido com o status agregado “LLM”: este pode estar saudável se qualquer modelo responder, mesmo que o preferido esteja offline.

### 5.3 Guia

Conteúdo estático explicando que o documento é Markdown, que contexto descreve a sessão e instruções descrevem a transformação do conteúdo, e que referências como `[audio:00:12]` são controladas internamente pelo switch. O usuário não precisa conhecer sintaxe de marcadores para personalizar o documento. A plataforma injeta transcrição, contexto e regras internas.

### 5.4 Conta

Mostra avatar com inicial, username e “Usuário local”. É informativa: não há edição de perfil, troca de senha, exclusão de conta ou cobrança neste painel.

### Oportunidades de usabilidade

- Escolher um termo único para template/prompt e explicar seu efeito com exemplos de resultado.
- Separar estilo, estrutura, conteúdo e compartilhamento em grupos compreensíveis.
- Exibir descrição e finalidade dos templates na seleção, não apenas nome.
- Distinguir templates da plataforma, próprios e compartilhados; oferecer ações compatíveis com permissões reais.
- Definir se “padrão” deve ser pessoal, e corrigir persistência antes de prometer esse comportamento.
- Considerar prévia de documento e comparação entre estilos como novas funcionalidades, não como capacidades atuais.
- Avisar sobre mudanças não salvas e apresentar erros perto dos campos.
- Explicar que público permite uso por outras contas; não significa conceder propriedade ou tornar sessões públicas.

## 6. Modal Nova sessão

É global no layout autenticado. Pode abrir pela sidebar, cabeçalho, linha de caderno ou estado vazio. Quando vem de um caderno, recebe seu ID; pela sidebar começa em `/root`. Ao concluir, fecha, dispara atualização local da biblioteca e navega para `/sessions/<id>?source=<microphone|upload|youtube>`.

### Layout e interações atuais

Overlay com escurecimento e blur; painel de até 768 px, altura máxima de 90vh e rolagem interna. Área principal com fontes/templates/dados/ajustes e coluna de caderno de 260 px em telas grandes; empilhamento no espaço menor. Rodapé com Cancelar e Criar sessão ou Importar vídeo. Não há botão X no cabeçalho atual. Clicar fora, Cancelar ou Escape fecha o diálogo. Há contenção de Tab, bloqueio de scroll do body e restauração do foco ao fechar.

Carrega prompts e pastas separadamente. Seleciona o prompt marcado padrão, ou o primeiro da lista. Falha na listagem de prompts vira lista vazia e “Nenhum prompt cadastrado”, sem distinguir erro de ausência; criação fica desabilitada. Falha nas pastas também vira lista vazia.

### Fontes

| Fonte | O que acontece |
|---|---|
| Microfone | Padrão inicial; cria sessão `ACTIVE` e abre painel de captura. Criar não inicia automaticamente a gravação |
| Arquivo | Cria sessão `ACTIVE`; o arquivo é escolhido/enviado na próxima tela, não no modal |
| YouTube | Exige link válido, normaliza a URL e cria sessão `IN_PROGRESS`; enfileira importação/transcrição para posterior geração |

YouTube aceita vídeos de até 30 minutos para usuários comuns e 300 minutos para a conta `luizgabe`. O backend define essa permissão a partir do usuário autenticado; a UI apenas comunica. Limite de URL: 2.048 caracteres. Se enfileirar falhar, a sessão já criada é marcada `ERROR` e a API devolve erro com ID. Não prometer sucesso de importação apenas porque o registro da sessão foi criado.

### Dados e personalização

- Template é obrigatório; lista mostra nome e selo padrão.
- Título opcional, até 120 caracteres no backend.
- Contexto opcional, até 4.000 caracteres no backend.
- Caderno opcional: `/root` ou pasta existente do usuário, em árvore expansível e ordenada por nome.
- Ajustes da sessão repetem formalidade, detalhamento, título/seções/subseções/listas/tabelas/referências e modo Reunião/Aula.
- Instruções só para esta sessão, até 8.000 caracteres; texto do template aparece como placeholder.

Os controles exibem o valor herdado do template até serem alterados. Overrides nulos significam herdar. Instruções específicas não vazias **substituem** as instruções do template na resolução da geração; não são automaticamente anexadas. Trocar o template no modal limpa todos os ajustes específicos já feitos, inclusive instruções. Ajustes locais não editam o template original.

O template é referenciado por ID; os campos sem override são resolvidos contra o template. Não assumir que a sessão guarda uma cópia imutável de todas as configurações. Alterar um template pode influenciar gerações futuras que ainda herdam seus valores; documentos já salvos continuam sendo registros próprios.

Durante criação há loading e prevenção de envio repetido na função. O fieldset das fontes fica desabilitado, mas nem todos os demais controles são bloqueados e o diálogo ainda pode ser fechado. É uma condição a revisar para evitar abandonar uma criação em andamento sem saber seu resultado.

### Oportunidades de usabilidade

- Priorizar fonte, template e destino; considerar divulgação progressiva dos ajustes avançados.
- Explicar as próximas etapas por fonte: gravar, selecionar arquivo ou aguardar importação.
- Diferenciar visualmente “herdado do template” de “personalizado nesta sessão”.
- Evitar perda silenciosa de ajustes ao trocar template.
- Mostrar limites e explicar contexto versus instruções com exemplos curtos.
- Deixar claro que “Criar sessão” não equivale a “Começar gravação”.
- Projetar erro ao carregar templates/pastas, lista vazia, sem modelo disponível, criação pendente e importação falha.

## 7. Status operacional — `/status`

Página autenticada, técnica e de diagnóstico. Não é status público nem histórico de incidentes. Cabeçalho “Status operacional / Serviços do Nebula”, resumo geral e Atualizar. Faz requisição inicial e polling a cada dez segundos. Carregamento inicial mantém skeleton por pelo menos 700 ms; atualização posterior mantém dados anteriores. Erro exibe alerta e pode coexistir com dados antigos: o horário da última checagem é essencial para reconhecer dados desatualizados.

Resumo: Geral, Saudáveis, Alertas e Indisponíveis. “Alertas” soma serviços degradados e inativos. Cada card mostra nome, mensagem, estado, latência em ms, estado do circuit breaker, número de falhas e última checagem. Há diagrama animado de conexões, filas BullMQ e uptime da API em segundos.

| Serviço | O que a checagem comprova |
|---|---|
| API | A função de status respondeu |
| PostgreSQL | Executa `SELECT 1` |
| Redis | Responde a ping |
| MinIO | Bucket acessível via `HeadBucket` |
| BullMQ | Consulta contagens das filas; jobs falhos retidos geram degradação |
| Groq worker | Endpoint de métricas acessível |
| Worker gRPC / faster-whisper | Modelo pronto via chamada de status; pode ser classificado como opcional/inativo |
| LLM | Pelo menos um modelo disponível |

Estados de serviço: saudável, degradado, indisponível, inativo. Timeout geral por checagem: 2,5 s. API/Postgres/Redis/MinIO/BullMQ são críticos: um deles `down` torna o geral indisponível. Queda/degradação de outros serviços torna o geral degradado. Inativo isoladamente não degrada o geral, embora conte em Alertas na UI.

Filas `post-processing` e `transcription-jobs`: Waiting, Active, Completed e Failed, apresentados como Wait/Active/Done/Fail. São contagens retornadas pelo BullMQ, sem janela temporal explícita ou SLA. Não chamar de taxa de sucesso diária nem de backlog total sem regra adicional. Não há botões para reiniciar serviços, limpar filas ou reexecutar jobs nessa página.

O diagrama mostra Web → API; API → Postgres, Redis, MinIO, BullMQ, gRPC e LLM; BullMQ → Groq worker. Animações são ilustração de conexões, não tráfego medido. O nó Web representa a interface, não uma checagem independente de saúde.

### Oportunidades de usabilidade

- Mostrar impacto no trabalho: “importações podem atrasar”, “geração de documento indisponível”, desde que derivado de regras confiáveis.
- Separar serviço opcional inativo de falha real.
- Explicar breaker e falhas em detalhes progressivos; não exigir familiaridade com infraestrutura.
- Traduzir rótulos das filas e diferenciar snapshot atual de histórico.
- Tornar último sucesso, atualização pendente e dados antigos evidentes.
- Preservar leitura mobile: diagrama tem largura mínima de 760 px e tabela de filas de 440 px, com scroll horizontal.
- Não usar movimento do diagrama como evidência de que um job está avançando.

## 8. Tela da sessão — `/sessions/:id`

Cabeçalho com retorno à biblioteca, template e ação “Editar template”, título renomeável, data, estado, ID em detalhes recolhidos, caminho de pastas, Perguntar e Excluir. “Editar template” aqui troca o template associado à sessão por um modal de seleção; não abre o editor completo das configurações nem dispara geração por si só.

Sessão ativa: painel de captura com escolha de microfone, motor de reconhecimento e opção de envio de arquivo conforme fonte. Tipos aceitos no seletor incluem MP3, WAV, WebM, OGG, M4A e `audio/*`. A seleção inicial do modal orienta o painel. Há serviços de gravação, persistência local e recuperação; navegação não deve ser tratada como ordem implícita para descartar áudio.

Sessão encerrada/processando/com erro: marcos de gravação, pipeline, transcrição, documento e insights. Atenção: a variável de interface `isEnded` inclui `IN_PROGRESS` e `ERROR`, portanto um badge “Encerrada” não é prova de conclusão bem-sucedida. Perguntar pode aparecer antes de existir transcrição suficiente; o backend rejeita perguntas sem transcrição.

O áudio aparece em player fixo inferior quando há mídia. Referências temporais no texto/documento buscam o momento correspondente; o sistema lida com áudio completo de upload ou partes de stream. Preservar relação entre seleção, posição de reprodução e texto. URLs de mídia são assinadas e temporárias, não links públicos permanentes.

Documento: visualização Markdown, edição, salvamento, seleção de versões, cópia, download `.md` e geração de nova versão. Regerar é uma operação explícita e deve ter feedback próprio. Não confundir exportação da transcrição com download do documento.

Insights: geração/atualização, resumo, tarefas com responsável e prazo quando informados, “Ouvir fonte”, tags e tom do texto. Exportação da transcrição oferece SRT, VTT, PDF, DOCX, JSON, MD e TXT. Enquanto insights estão na fila/em execução, há acompanhamento e indicação de trabalho pendente.

Perguntas: drawer sobre a sessão com resposta progressiva por SSE, usando a transcrição. Depende de texto disponível e modelo. Excluir sessão exige confirmação; a implementação usa exclusão lógica (`isDeleted`), e não oferece restauração na interface.

## 9. Login e cadastro

Marca, descrição “gravação e transcrição de áudio”, alternância Entrar/Cadastrar, username, senha, mostrar/ocultar senha, envio com loading e erro. Usuário autenticado segue para `/`. Cadastro exige username de 3–32 caracteres e senha de ao menos oito caracteres no backend. Cadastro pode estar desativado por configuração do servidor mesmo com a aba visível. Não há recuperação de senha ou autenticação social nessa tela.

## 10. Regras transversais que precisam sobreviver ao redesign

1. Sessões e pastas são do usuário autenticado; sessões removidas ficam fora das consultas usuais. Templates públicos têm visibilidade compartilhada, sem tornar o áudio ou sessão públicos.
2. Sessão precisa de template válido e pasta própria quando especificada. Destino sem pasta é permitido.
3. Encerrar a sessão por endpoint exige pelo menos uma transcrição não vazia; sem fala transcrita retorna conflito, informando que áudio foi salvo. Encerramento enfileira documento, que ainda pode estar pendente ou falhar.
4. Status de processamento usa histórico persistido e eventos por SSE. Biblioteca, pipeline e status da infraestrutura têm fontes e ritmos de atualização diferentes.
5. Documento é Markdown. Transcrição, contexto e regras internas são montados no backend. Não obrigar usuário a inserir variáveis técnicas ou timestamps manualmente.
6. Modelo padrão pertence à configuração da conta. Personalização do documento pertence ao template e/ou sessão. Motor de fala é outra responsabilidade.
7. Edição de texto, regeração de documento e geração de insights são operações diferentes; comunicar quando um resultado fica desatualizado em relação à fonte.
8. Arquivo escolhido, áudio enviado, transcrição concluída e documento pronto são marcos distintos. Preservar os dados já produzidos quando uma etapa posterior falhar.
9. Não inventar colaboração em tempo real, organizações, planos pagos, calendário, busca semântica, histórico de incidentes ou permissões administrativas: não são capacidades demonstradas por estas telas.

## 11. Sistema visual e acessibilidade existentes

React 18, Vite, Tailwind, ícones `lucide-react`, componentes Button/Badge/Spinner/Skeleton/Toggle. Tokens `ink`, `jade`, `amber`, `rose`; CSS global também usa azul para foco, reprodução e alguns estados. Fundos claros, superfícies brancas/translúcidas, bordas discretas, sombras suaves e cantos arredondados. A marca tem tratamento próprio de wordmark.

Há classes globais `nebula-*` que refinam o visual além das classes Tailwind nos componentes. Um redesign deve revisar CSS global e componentes juntos. As telas já adaptam grids e espaçamento, mas tabelas, árvore hierárquica, modal extenso e player fixo exigem atenção especial no mobile.

Preservar e ampliar: foco visível, navegação por teclado, nomes acessíveis em botões de ícone, diálogos com foco contido/restaurado, `role=alert` nos erros e status de carregamento. Há regras de movimento reduzido no CSS. Não depender apenas de cor, tooltip ou hover para ações essenciais. Avaliar contraste dos muitos textos em `ink-400`, tamanho das áreas de toque, hierarquia dos headings e interferência do player fixo na leitura.

Há mistura de textos com e sem acentuação e de termos em português/inglês. Revisar microcopy e terminologia como parte do trabalho, mantendo precisão dos estados.

## 12. Cenários para validar a proposta

- Primeiro acesso, nenhuma sessão/caderno, template carregando ou indisponível.
- Criar rapidamente uma gravação com os padrões e entender quando ela realmente começa.
- Criar sessão em subpasta sem perder o destino selecionado.
- Importar arquivo entendendo que a seleção ocorre na próxima etapa.
- Importar YouTube válido, inválido, longo demais ou com falha posterior.
- Personalizar uma sessão sem mudar o template; trocar template após ajustes.
- Editar template próprio, usar público de outro dono e entender limitações de edição.
- Escolher padrão e verificar se persiste após recarregar, considerando a inconsistência documentada.
- Modelo preferido offline com outro modelo disponível; nenhum LLM disponível.
- Gravação com silêncio, permissão de microfone negada, recuperação local e navegação entre telas.
- Transcrição pronta com documento ainda pendente ou falho.
- Buscar globalmente, buscar em caderno e navegar para descendentes.
- Excluir pasta preservando sessões versus excluindo conteúdo.
- Status desatualizado por erro de consulta, worker opcional inativo e serviço crítico indisponível.
- Usar somente teclado, tela pequena e preferência de movimento reduzido.

## 13. Fontes de implementação para aprofundamento

- Rotas e layout: `apps/web/src/App.tsx`, `components/layout/AppLayout.tsx`, `components/ui/Sidebar.tsx`.
- Telas: `apps/web/src/pages/{Dashboard,Settings,Status,Session,Login}.tsx`.
- Criação: `apps/web/src/components/NewSessionModal.tsx` e `hooks/useDialogFocus.ts`.
- Contratos/chamadas: `apps/web/src/api/client.ts`.
- Sessão: `RecordingPanel`, `SyncedTranscript`, `DocumentEditor`, `TranscriptProductivity`, `SessionAudioPlayer`, `QADrawer`, `PipelineStatus`, `RecordingRecovery`, `ActiveRecordingNotice`.
- Regras: `apps/api/src/routes/{sessions,prompts,folders,system,auth}.ts`.
- Geração e padrões: `apps/api/src/lib/prompts.ts`.
- Saúde: `apps/api/src/lib/system/status.ts`.
- Visual: `apps/web/src/index.css`, `tailwind.config.js` e `components/ui`.

## 14. Pedido sugerido para a IA responsável pelo redesign

“Use este documento como contexto do Nebula. Proponha uma experiência coerente para biblioteca inicial, configurações, status operacional e criação de sessão, considerando também a continuidade com gravação, transcrição, documento e player. Diferencie comportamento atual, correção de inconsistência e nova funcionalidade. Preserve regras de propriedade, herança de configuração, fontes de áudio e operações assíncronas. Entregue arquitetura de informação, fluxos, estados de erro/vazio/carregamento, layouts desktop/mobile, microcopy e decisões de acessibilidade. Priorize clareza de estado e simplicidade da criação, sem expor detalhes técnicos desnecessários. Não transforme os problemas atuais de permissões, padrão de templates e status em requisitos desejados.”
