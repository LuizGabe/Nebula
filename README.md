# Nebula

Nebula e uma aplicacao para gravar ou enviar audio, transcrever o conteudo e gerar documentos com IA. O projeto combina um frontend React, uma API Fastify, PostgreSQL, Redis/BullMQ, MinIO e workers Python para processamento de audio.

O fluxo principal e simples: o usuario cria uma sessao, escolhe um prompt cadastrado no banco, grava ou envia um audio, acompanha o processamento e revisa o documento Markdown gerado. Os prompts nao vivem mais em arquivos compartilhados; eles sao registros editaveis no banco de dados.

## Funcionalidades

- Autenticacao local com usuario e senha.
- Redirecionamento automatico de `/login` para o dashboard quando o usuario ja esta logado.
- Dashboard de sessoes com criacao por prompt dinamico.
- Gravacao pelo navegador e upload de arquivos de audio.
- Importacao de audio de videos do YouTube, com transcricao e documento automaticos.
- Upload seguro para MinIO usando presigned URLs.
- Processamento assincrono com Redis e BullMQ.
- Transcricao por workers Python.
- Geracao de documentos com LLM via Groq ou Ollama.
- Editor Markdown para revisar documentos gerados.
- Q&A via SSE sobre a transcricao da sessao.
- CRUD de prompts em `/prompts`.
- Prompts publicos e privados, com dono (`ownerId`) e prompt padrao (`isDefault`).

## Arquitetura

```text
nebula/
|-- apps/
|   |-- api/                 # Backend Fastify + Prisma + BullMQ
|   |   |-- prisma/          # Schema, SQL bootstrap e seed
|   |   `-- src/
|   |       |-- events/      # Eventos de pipeline e status
|   |       |-- jobs/        # Filas e processadores
|   |       |-- lib/         # Prisma, Redis, storage, LLM e prompts
|   |       |-- routes/      # Rotas REST, SSE e WebSocket
|   |       `-- workers/     # Inicializacao de workers Node
|   |-- web/                 # Frontend React + Vite + Tailwind
|   |   `-- src/
|   |       |-- api/         # Client HTTP
|   |       |-- components/  # Recorder, editor, status, UI
|   |       |-- hooks/       # Recorder e status de processamento
|   |       |-- pages/       # Login, Dashboard, Session, Settings
|   |       `-- store/       # Estado de autenticacao
|   |-- groq_worker/         # Worker Python para processamento Groq/batch
|   `-- parakeet_worker/     # Worker Python/gRPC para transcricao
|-- scripts/                 # Utilitarios, como download de modelos
|-- docker-compose.yml       # Ambiente production-like local
|-- docker-compose.dev.yml   # Ambiente de desenvolvimento com volumes
|-- pnpm-workspace.yaml
`-- package.json
```

## Stack

| Area | Tecnologias |
| --- | --- |
| Web | React 18, Vite, Tailwind CSS, Zustand, Milkdown/Crepe, lucide-react |
| API | Node.js, Fastify, Prisma 7, Zod, BullMQ, secure-session |
| Banco/Fila/Storage | PostgreSQL 16, Redis 7, MinIO |
| IA | Groq SDK, Ollama, workers Python |
| Audio | Web MediaRecorder, workers Python, gRPC, FFmpeg |

## Variaveis de Ambiente

Use `.env.example` como base para criar `.env` na raiz do projeto.

Variaveis principais:

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `DATABASE_URL`
- `REDIS_URL`
- `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`
- `MINIO_PUBLIC_ENDPOINT`, `MINIO_INTERNAL_ENDPOINT`, `MINIO_ENDPOINT`
- `MINIO_WEBHOOK_SECRET`
- `SESSION_SECRET`, `SESSION_SALT`
- `REGISTRATION_ENABLED`
- `GROQ_API_KEY`
- `OLLAMA_URL`
- `DEFAULT_MODEL`
- `VITE_API_BASE_URL`

Prompts ficam na tabela `prompts` e sao carregados dinamicamente pela API.

## Rodando com Docker

Para subir o ambiente principal:

```bash
docker compose up -d --build
```

Servicos expostos:

- Web: `http://localhost:5173`
- API: `http://localhost:3333`
- MinIO API: `http://localhost:9000`
- MinIO Console: `http://localhost:9001`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

O `docker-compose.yml` usa build production-like:

- `web` serve arquivos estaticos via Nginx na porta interna `80`, exposta como `5173`.
- `api` roda `pnpm run start`.
- `groq_worker` roda separado.
- `parakeet` fica em profile opcional.

Para subir o worker Parakeet:

```bash
docker compose --profile parakeet up -d --build parakeet
```

## Rodando em Desenvolvimento

Suba o compose de desenvolvimento:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

Esse arquivo monta volumes para `apps/api/src`, `apps/api/prisma` e `apps/web/src`, facilitando hot reload.

Tambem e possivel rodar Node localmente:

```bash
pnpm install
pnpm dev
```

## Videos do YouTube

No modal **Nova sessao**, escolha **YouTube**, cole o link do video e selecione o prompt.
Sao aceitos links `youtube.com/watch?v=...`, `youtu.be/...` e `youtube.com/shorts/...`.
O worker verifica a duracao antes do download: ate 30 minutos por usuario ou 300 minutos para `luizgabe`.
Lives, playlists sem video selecionado e videos privados/protegidos nao sao importados.

O `groq_worker` usa `yt-dlp[default]`, FFmpeg e Node 22 para extracao do audio.
Se o titulo da sessao estiver vazio, o titulo do video e aplicado automaticamente; titulos personalizados sao preservados.
Downloads transitorios recebem ate tres tentativas; erros e progresso aparecem via SSE.
O audio fica em `sessions/<id>/youtube/audio.mp3` no MinIO. Esse caminho nao dispara uma segunda
transcricao pelo webhook: o job de ingestao chama o mesmo processamento batch de uploads.
Videos longos sao divididos em requisicoes de ate dez minutos ao Groq, preservando timestamps
na linha do tempo original. A geracao do documento continua usando a fila `post-processing` e
esta sujeita aos limites do modelo de IA configurado.
Transcricoes longas sao sintetizadas em etapas antes da geracao final, com referencias ao audio.
O reprocessamento acompanha o job solicitado ate concluir ou falhar, preservando as versoes anteriores do documento.

A API adiciona o estado `ERROR` ao enum de sessoes na inicializacao com SQL conservador.
Configuracoes antigas de modelos Compound continuam aceitas e usam GPT-OSS 20B/120B no Groq.

## Banco de Dados

O schema Prisma fica em:

```text
apps/api/prisma/schema.prisma
```

Para gerar o Prisma Client:

```bash
cd apps/api
pnpm exec prisma generate
```

Para validar o schema:

```bash
pnpm exec prisma validate
```

Para aplicar o bootstrap conservador usado neste projeto:

```bash
pnpm exec prisma db execute --file prisma/prompt_bootstrap.sql
```

O arquivo `prompt_bootstrap.sql` existe para criar/adaptar a tabela de prompts sem derrubar dados antigos de sessoes/documentos.

## Seed de Prompts

O seed atual cria ou atualiza tres prompts iniciais:

- `Reuniao` como padrao
- `Aula`
- `Entrevista`

Todos sao marcados como publicos. Se existir o usuario `luizgabe`, eles tambem ficam associados a ele via `ownerId`.

Para rodar:

```bash
cd apps/api
pnpm run db:seed
```

## Prompts

Prompts sao gerenciados pelo backend e pelo frontend.

Campos principais:

- `id`
- `name`
- `content`
- `isDefault`
- `isPublic`
- `ownerId`
- `createdAt`

Regras atuais:

- `GET /prompts` lista prompts publicos e prompts privados do usuario logado.
- `POST /prompts` cria prompt do usuario logado.
- `PUT /prompts/:id` edita prompt do usuario ou prompt sem dono.
- `DELETE /prompts/:id` remove prompt do usuario ou prompt sem dono.
- Ao criar uma sessao, o frontend envia `promptId`.
- O job de pos-processamento busca o prompt da sessao no banco para gerar o documento.

## Rotas Principais da API

Autenticacao:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`

Sessoes:

- `GET /sessions`
- `POST /sessions`
- `GET /sessions/:id`
- `PATCH /sessions/:id/end`
- `PATCH /sessions/:id`
- `DELETE /sessions/:id`
- `GET /sessions/:id/status/stream`
- `POST /sessions/:id/question`

Prompts:

- `GET /prompts`
- `POST /prompts`
- `PUT /prompts/:id`
- `DELETE /prompts/:id`

Documentos:

- `GET /sessions/:id/document`
- `GET /sessions/:id/document/content`
- `PATCH /sessions/:id/document`
- `POST /sessions/:id/document/reprocess`

Audio:

- `POST /chunks/presigned-url`
- `POST /uploads/audio/presigned-url`
- `GET /ws/transcribe`

LLM:

- `GET /llm/models`
- `PATCH /users/config`

## Fluxo de Uso

1. Acesse `http://localhost:5173`.
2. Crie ou entre com um usuario.
3. Abra Configuracoes para conferir ou editar prompts.
4. No dashboard, clique em Nova sessao.
5. Escolha um prompt cadastrado.
6. Grave audio ou envie um arquivo.
7. Encerre a sessao e acompanhe o status.
8. Revise o documento gerado e use o Q&A quando necessario.

## Comandos Uteis

Na raiz:

```bash
pnpm install
pnpm dev
pnpm build
docker compose up -d --build
docker compose logs -f api
docker compose logs -f web
```

Na API:

```bash
cd apps/api
pnpm run dev
pnpm run build
pnpm run db:seed
pnpm exec prisma generate
pnpm exec prisma validate
```

No Web:

```bash
cd apps/web
pnpm run dev
pnpm run build
pnpm run preview
```

## Observacoes

- Prompts sao registros do banco e podem ser publicos ou privados.
- O compose production-like expoe o Web em `5173`, mas o Nginx dentro do container escuta em `80`.
- Se a API retornar `Route GET:/prompts not found`, o container da API esta com imagem antiga. Rode `docker compose up -d --build api web`.
- Se os prompts nao aparecerem, confirme que o seed rodou no banco usado pelo container.

## Licenca

ISC.
