# Transcrição resiliente do Nebula

## Gravação e recuperação

`AudioRecorderService` possui a captura, o relógio e a FSM; `useRecorder` apenas
assina snapshots. O serviço permanece ativo entre montagens React. Um Web Lock
por sessão impede duas abas de gravar ou recuperar o mesmo áudio simultaneamente.

Cada `dataavailable`, solicitado por `start(1000)`, é persistido via Dexie. O
manifesto associa a gravação ao usuário autenticado. A recuperação verifica
fragmentos pendentes ao entrar no aplicativo e permite enviar, baixar ou descartar
com confirmação. Uploads reutilizam a mesma chave/registro e os webhooks MinIO
utilizam um jobId determinístico. Fragmentos enviados continuam disponíveis
localmente; não há expurgo automático nesta versão.

Todos os fragmentos pertencem à mesma instância MediaRecorder. Reconexões trocam
a fonte de um MediaStreamAudioDestinationNode, preservando o contêiner. A gravação
retorna pausada após reconectar. A ordenação exige índice zero e sequência sem
lacunas; fragmentos não são arquivos de áudio independentes.

IndexedDB não garante a sobrevivência do fragmento ainda não confirmado nem de
dados removidos pelo navegador/usuário. `timeslice` não é um cronômetro exato.
Gravações MP4 interrompidas antes da finalização podem precisar de reparo do
contêiner. Suspensão de abas, bloqueio de tela e interrupções do SO exigem
homologação nos navegadores/dispositivos de destino. Web Speech continua sendo
um recurso do navegador, com ciclo de vida próprio e sem garantia offline.

## Contratos e banco

Os dois `.proto` incluem `Word`, palavras por segmento, orador e identificação do
motor/modelo no status. Regeneração:

```powershell
pnpm --filter api proto:generate
# A partir de apps/parakeet_worker (equivalente ao scripts/compile_proto.sh):
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. proto/transcriber.proto
```

O startup da API executa `ensureTranscriptSchema()` antes de aceitar requisições.
Ele adiciona JSONB de palavras, orador, revisão, texto original, flag de edição,
insights, nomes de oradores e picos/duração da mídia. Nenhuma coluna antiga é
apagada ou renomeada. Os campos Float legados permanecem para compatibilidade;
os novos writes e contratos usam valores inteiros em milissegundos.

O faster-whisper preserva as palavras em streaming, flush, gRPC e batch. Groq
solicita palavras e segmentos, multiplica os tempos pelo fator efetivo de
aceleração e depois soma o offset da fatia original. Picos são calculados sobre
o áudio original, sem aceleração, com memória limitada e fora do event loop.
Falha na geração de picos não impede a transcrição.

Áudios antigos não são reprocessados automaticamente. Continuam reproduzíveis
sem waveform e seus segmentos continuam clicáveis, mesmo sem palavras.

## Diarização opcional

Disponível nos caminhos batch dos dois workers; não há diarização incremental
de streaming. Aceite os termos do modelo no Hugging Face e configure no `.env`:

```dotenv
DIARIZATION_ENABLED=true
DIARIZATION_MODEL=pyannote/speaker-diarization-community-1
HF_TOKEN=<token com acesso ao modelo>
```

Reconstrua os workers pelo compose habitual. O build arg `ENABLE_DIARIZATION`
instala `requirements-diarization.txt` somente quando habilitado. Para execução
Python direta, instale esse arquivo no ambiente do respectivo worker. O modelo
é carregado sob demanda e reutilizado com acesso serializado. Esta integração
usa CPU por padrão; o custo de memória/latência precisa ser medido em produção.
Sem a opção, não há import/download do pyannote. Com a opção habilitada, falta de
dependências, token ou modelo gera falha explícita do job.

As implementações `inference/diarization.py` e `audio/waveform.py` são iguais nos
dois workers porque suas imagens possuem contextos de build independentes.
Mantenha ambas sincronizadas ao alterar os algoritmos.

## Reprodução, edição e produtividade

WaveSurfer usa o mesmo HTMLAudioElement do player e recebe picos pelo endpoint
autenticado `/sessions/:id/audio-media/:mediaId/peaks`. O relógio único publica
tempo absoluto em ms. A palavra ativa é atualizada no DOM por busca binária,
sem renderizar toda a transcrição a cada frame. SVG ao vivo usa rAF e respeita
movimento reduzido. Espaço reproduz/pausa e setas movem cinco segundos quando o
foco não está em controles, formulários ou editores.

Busca/substituição é literal, diferencia maiúsculas e permite escopo global ou
por segmento, navegação e prévia. Salvar preserva id e tempos, guarda texto
original e incrementa revisão; conflitos retornam 409. Texto editado mantém
as palavras originais como base, mas usa reprodução por segmento em vez de
apresentar um alinhamento por palavra que deixou de ser confiável. Um worker
repetido não sobrescreve segmentos editados. Renomear um orador atualiza um
mapa global por sessão sem alterar seus rótulos técnicos.

Insights são jobs de `post-processing`, separados da geração do documento.
Saídas JSON são validadas por Zod e referências devem corresponder a segmentos
enviados ao modelo. Responsável e prazo podem ser null. Transcrições longas são
processadas em lotes sem truncamento silencioso. Edições invalidam insights;
revisões são verificadas em transação antes de salvar resultados novos.

`ExportService` reúne SRT, VTT, PDF, DOCX, JSON, Markdown e TXT. Legendas têm
até duas linhas de 42 caracteres e duração preferencial de 1–6 segundos. Sem
palavras alinhadas, o tempo é aproximado proporcionalmente dentro do segmento.
Essa aproximação não substitui alinhamento acústico. PDF usa Helvetica e DOCX
usa a fonte do leitor; caracteres fora do repertório da fonte PDF precisam de
uma futura política de fontes multilíngues.

## Verificação

```powershell
pnpm --filter api build
pnpm --filter nebula-frontend build
pnpm --filter api exec tsx tests/documentGeneration.test.ts
pnpm --filter api exec tsx tests/transcriptPremium.test.ts
pnpm --filter api exec tsx ../web/tests/recordingRecovery.test.ts
```

Na pasta `apps/api`: `node tests/browserRecording.test.cjs`,
`node tests/postProcess.test.cjs` e `node tests/transcriptEditing.test.cjs`.
Em cada worker: `python -m pytest`.

Os testes cobrem armazenamento, reconstrução, falha de upload, quota, reconexão,
formato das exportações, referências de insights, timestamps e atribuição de
oradores. Inferência real do pyannote, sessão LLM real, hardware Bluetooth,
encerramento abrupto do navegador e layout visual dos documentos devem ser
homologados com serviços/modelos e dispositivos reais antes de liberar essas
capacidades em produção.
