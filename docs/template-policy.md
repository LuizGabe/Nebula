# Templates — política e migração da etapa 3

## Identidade e autorização

`Prompt.platformKey` identifica os registros provisionados pela plataforma. As chaves são estáveis e versionadas; nomes nunca são usados para determinar origem. Somente a inicialização controlada pode definir essa chave. O contrato público continua usando `/prompts`, `promptId` e `isDefault` por compatibilidade; a interface usa “Template”.

| Origem | Usar / duplicar | Editar / excluir |
|---|---|---|
| Da plataforma | Quando disponível | Não, para usuários comuns |
| Próprio | Proprietário; outras contas se público | Somente proprietário |
| Público de terceiros | Sim | Não |
| Legado sem proprietário, público | Sim, somente leitura | Não |
| Legado sem proprietário, privado | Não aparece em novas seleções | Não |
| Excluído logicamente | Não | Não |

O backend retorna `origin` e `capabilities` efetivas. A interface não infere autorização pelo nome, por ser público ou pelo flag antigo de padrão. Tornar público compartilha somente o template, sem alterar a propriedade ou o acesso às sessões, transcrições, documentos e áudios.

Registros existentes mantêm IDs, nomes persistidos, conteúdo, proprietário e vínculos. Não há atribuição automática de proprietário para legados. Registros antigos com proprietário continuam sendo próprios/compartilhados, mesmo que tenham nomes iguais aos templates nativos. Registros sem proprietário ficam em política explícita de somente leitura; uma atribuição futura exigirá uma auditoria administrativa fora deste trabalho.

A inicialização cria os sete templates da plataforma apenas quando a chave está ausente. Não atualiza registros que já têm a chave, não mescla registros e não renomeia legados. Em colisões com o índice de nome único existente, cria um novo nome com sufixo Nebula, preservando o registro anterior. A apresentação pode ocultar somente esse sufixo de provisionamento de uma chave conhecida, sem modificar o banco. Duplicações usam uma cópia privada de propriedade do usuário, com nome único; o índice global de nomes foi preservado e conflitos de edição/criação retornam 409.

## Padrão pessoal e leitura

`User.defaultPromptId` é uma referência individual, não uma preferência global nem um valor inferido de `Prompt.isDefault`. O flag antigo permanece no banco como dado histórico e não participa da decisão de padrão.

`GET /prompts` não executa DDL, inicialização, reparo de conteúdo nem atualização de preferências. Retorna o catálogo utilizável e `defaultPromptId` efetivo. O `isDefault` de cada item é calculado para a conta autenticada.

`PUT /prompts/default` aceita somente um template utilizável pela conta, ou null para remover a preferência explícita. Se uma referência pessoal ficar indisponível, a leitura usa fallback determinístico: briefing da plataforma, demais templates da plataforma, depois demais utilizáveis por criação crescente e ID. Isso não altera preferências persistidas nem afeta outras contas. Sem templates utilizáveis, retorna null e a criação apresenta ausência de opções.

Clientes antigos que enviam `isDefault` na criação/edição de um template próprio passam a alterar apenas a preferência da conta. Para um item somente leitura, o novo cliente usa a operação separada de padrão, sem tentar editar o template.

## Exclusão, privacidade e gerações futuras

Excluir pela API preenche `Prompt.deletedAt`; não remove fisicamente o registro e não rompe os FKs das sessões e documentos. O template desaparece das novas seleções. Documentos salvos e histórico continuam disponíveis ao proprietário da sessão.

Tornar privado preserva a referência de sessões de terceiros, mas impede novas gerações com esse template para essas contas. Excluir também impede futuras gerações do próprio usuário com a referência excluída. O endpoint de reprocessamento retorna 409 antes de enfileirar e o worker valida novamente o acesso antes de chamar o gerador. Nunca substitui silenciosamente o template associado pelo padrão pessoal. A pessoa precisa escolher explicitamente outro template. As perguntas sobre transcrições próprias continuam no fluxo existente e não recebem as instruções privadas do template.

Respostas de sessões com referência indisponível mantêm a identificação histórica e sinalizam `canUse: false`, sem expor as instruções/descrição privadas. A seleção na sessão permite manter overrides explícitos, restaurar a herança do novo template ou cancelar. Essa operação não dispara geração por si só.

## Migração e aplicação

Alterações aditivas:

- `prompts.platformKey TEXT NULL` com índice único.
- `prompts.deletedAt TIMESTAMP(3) NULL`.
- `users.defaultPromptId TEXT NULL`, FK para prompts com ON DELETE SET NULL.

Script isolado: `apps/api/prisma/template_preferences.sql`. A mesma política é aplicada de forma repetível por `ensureTemplatePolicySchema`, chamada na inicialização dos templates antes de a API servir requisições. A inicialização usa uma transação com lock de provisionamento para evitar criação concorrente.

`pnpm --filter api db:seed` agora chama a mesma inicialização aditiva. A antiga rotina de seed que apagava templates, anulava vínculos e elegia um padrão global foi removida. As rotinas de evolução de templates conservam as colunas legadas e não sobrescrevem instruções não nulas, inclusive strings vazias. A migração de `userInstructions` para `instructionsOverride` ocorre somente quando a coluna nova é introduzida; restaurar herança depois não ressuscita overrides antigos.

No ambiente de desenvolvimento local desta execução, a migração foi **aplicada** e a inicialização foi executada repetidamente nos testes, preservando todos os registros preexistentes. As sete novas chaves da plataforma foram provisionadas. A API local foi reiniciada para carregar as regras. Nos demais ambientes, a migração está apenas **preparada**; não houve deploy, reset ou migração destrutiva.

## Criação e gerenciamento

Configurações mantém o gerenciamento em `?section=templates`, com grupos por origem, descrição, padrão pessoal e ações autorizadas. O formulário agrupa identidade, estilo, estrutura, referências, instruções e disponibilidade. Limites: nome 80, descrição 500 e instruções 8000 caracteres; campos obrigatórios e espaços em branco são validados no backend.

Nova sessão usa uma coluna: fonte, template/descrição, título opcional (120), destino com caminho/cor, contexto recolhível (4000) e ajustes recolhíveis (instruções até 8000). O padrão vem da conta e o destino do acionador. O limite de YouTube vem de `/sessions/creation-options`, calculado pela mesma regra de autorização usada no envio. O cliente não reproduz permissões por nome da conta.

Overrides nulos continuam herdando por referência. Trocar template sem overrides é direto; com overrides exige manter somente os campos explícitos, restaurar valores do novo template ou cancelar. Instruções específicas substituem as instruções do template; nunca são apagadas por uma troca silenciosa. Não há promessa de snapshot imutável ou prévia de geração.

Gerenciar a partir da criação suspende a apresentação do diálogo, preservando a mesma instância e seu rascunho em memória. Voltar atualiza opções sem redefinir seleção, destino ou ajustes. Rascunhos não são persistidos entre recargas. O guard usa diálogo compartilhado para troca de item/seção/rota, voltar/avançar e saída da conta; recarregar/fechar a janela usa o aviso nativo obrigatório do navegador. A guarda de captura preexistente continua composta com a navegação.

Durante criação, todos os campos ficam bloqueados, há trava síncrona contra envio repetido e fechamento/saída ficam bloqueados até a resposta. Falhas devolvem os controles sem apagar campos. Se a API retornar `sessionId` junto da falha de importação, a interface oferece abrir essa sessão e desabilita outra submissão daquele rascunho. Não há retentativa automática de criação.

## Verificação e limites

- Builds de API e frontend incluem TypeScript; Prisma validate e generate.
- `pnpm --filter api exec tsx tests/templates.integration.ts`: PostgreSQL local, duas contas isoladas, padrões diferentes após várias leituras, listagem sem escrita, bootstrap repetido sem mudanças nos registros antigos, autorização de todas as origens, duplicação, referência após privacidade/exclusão, documento preservado e fallback sem reescrita da preferência. Somente os dados temporários de QA são removidos no final; templates da plataforma são provisionamento normal.
- Regressões de geração, reprocessamento, worker, YouTube, gravação do navegador e transcrição.
- `node apps/web/tests/runTranscriptInteraction.mjs tests/sessionCreation.test.tsx --dom`: três fontes, destino/padrão, três alternativas de troca, overrides explícitos, suspensão/retorno, destino indisponível, consulta vazia/falha, retry sem perder campos, falha de criação, trava de envio/fechamento e acesso à sessão já criada com importação falha.
- `node apps/web/tests/runTranscriptInteraction.mjs tests/templateManagement.test.tsx --dom`: capacidades, duplicação, padrão pessoal, rascunho após falha, confirmação de exclusão, proteção ao trocar item/seção/rota e voltar no navegador.
- Aparência/navegação também testa a composição da nova guarda com a guarda de captura. Biblioteca e interação de transcrição permanecem cobertas.

Inspeção visual: fluxo real de criação → Configurações → retorno ao rascunho, cancelado sem criar dados reais; desktop e mobile nos dois temas, readonly, campos expandidos, erro preservando rascunho e confirmação sobre o diálogo de criação. Falhas visuais são simuladas na página de QA identificada `tests/previewTemplates.html`, usando os componentes reais e nenhum backend. A página não faz parte das entradas do build de produção. Para reproduzir com Vite: `/tests/previewTemplates.html?mode=creation|management&theme=light` (sem theme usa escuro, `&error` simula consulta indisponível). Não houve ativação de microfone, envio de arquivos ou importação/geração em provedores reais nesta validação.

Capturas estão fora do Git, na pasta de visualizações desta conversa: `stage3-creation-*`, `stage3-management-*` e `stage3-template-switch-dialog.jpg`. Permanecem os avisos de bundle grande, Browserslist antiga e future flags do React Router. Não houve atualização de dependências.
