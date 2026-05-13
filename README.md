# Nebula

> **Uma plataforma inteligente e assíncrona para gravação, transcrição e geração automática de documentos utilizando IA local e em nuvem.**

---

## 📌 Sobre o Projeto

O **Nebula** é um ecossistema projetado para resolver o problema de documentação manual em reuniões e aulas. O sistema permite que o usuário grave áudio em tempo real ou faça o upload de arquivos de mídia. Utilizando uma arquitetura orientada a eventos e filas de processamento, o projeto transcreve o áudio foneticamente com precisão utilizando modelos ONNX (NVIDIA NeMo Parakeet) e, em seguida, aplica Modelos de Linguagem de Grande Escala (LLMs via Groq ou Ollama local) para gerar atas de reuniões, resumos de aulas e permitir interações de Perguntas e Respostas (Q&A) baseadas no contexto transcrito.

A arquitetura foi desenhada em um formato de **Monorepo** (gerenciado pelo `pnpm workspaces`), separando claramente as responsabilidades entre a interface de usuário (Frontend), a API de orquestração (Backend) e o processamento intensivo de áudio/IA (Worker Python).

---

## 🚀 Funcionalidades

* **Gravação e Upload Chunked:** Gravação de áudio em tempo real direto do navegador ou upload de arquivos longos com suporte a fatiamento seguro.
* **Processamento Assíncrono com BullMQ:** Orquestração de tarefas pesadas (transcrição e geração de LLM) em background utilizando Redis.
* **Transcrição Inteligente (AudioSplitter):** Worker Python customizado que divide áudios longos baseado em detecção de silêncio (evitando *Out of Memory* no modelo ONNX) e remove automaticamente *overlaps* textuais.
* **Geração Contextual de Documentos:** Templates específicos de LLM para formatar as transcrições em "Atas de Reunião" ou "Anotações de Aula".
* **Editor Markdown Rico:** Interface de edição integrada utilizando Milkdown/Crepe para revisão final dos documentos gerados.
* **Q&A Interativo via SSE:** Chat integrado com *Server-Sent Events* para fazer perguntas sobre o conteúdo da transcrição e receber respostas geradas por IA em tempo real (streaming).
* **Armazenamento S3:** Armazenamento seguro de *chunks* de áudio em infraestrutura compatível com S3 (MinIO).

---

## 🛠️ Tecnologias Utilizadas

| Camada | Tecnologias Principais | Propósito |
| --- | --- | --- |
| **Frontend** (`apps/web`) | React 18, Vite, Tailwind CSS, Zustand, Milkdown | Interface SPA, gerenciamento de estado e editor de texto rico (Markdown). |
| **Backend** (`apps/api`) | Node.js, Fastify, Prisma ORM, Zod, BullMQ | API RESTful, gerenciamento de banco de dados, orquestração de filas e integração S3/LLM. |
| **Worker** (`apps/parakeet_worker`) | Python 3.11, ONNX Runtime, asyncpg, FFmpeg | Inferência de IA para *Speech-to-Text* (Parakeet TDT 0.6B) e processamento de mídia. |
| **Integrações de IA** | Groq SDK, Ollama | Provedores de LLM para análise sintática e geração de documentos. |
| **Infraestrutura** | Docker, PostgreSQL, Redis, MinIO | Banco de dados relacional, cache/filas e *Object Storage*. |

---

## 📂 Estrutura de Pastas

O projeto utiliza um padrão de monorepo estruturado da seguinte forma:

```text
nebula/
├── apps/
│   ├── api/                   # Backend em Node.js/Fastify
│   │   ├── prisma/            # Schema do banco e migrações
│   │   └── src/
│   │       ├── jobs/          # Processadores de fila (BullMQ) para LLM
│   │       ├── lib/           # Adaptadores LLM (Groq/Ollama) e S3
│   │       └── routes/        # Endpoints da API (auth, sessions, chunks, documents)
│   ├── parakeet_worker/       # Serviço Python para Transcrição de Áudio
│   │   ├── audio_splitter.py  # Lógica de fatiamento de áudio seguro
│   │   ├── transcriber.py     # Wrapper de inferência do ONNX Runtime
│   │   └── worker.py          # Consumidor da fila Redis
│   └── web/                   # Frontend React
│       └── src/
│           ├── api/           # Integração com a API Backend
│           ├── components/    # Componentes UI reutilizáveis (Editor, Recorder)
│           └── pages/         # Páginas (Dashboard, Session, Login)
├── packages/
│   └── prompts/               # Templates textuais compartilhados para os LLMs
├── scripts/                   # Scripts de utilidade (ex: download de modelos)
└── docker-compose.yml         # Orquestração de dependências da infraestrutura

```

---

## 🔧 Configuração e Instalação

### Pré-requisitos

* [Node.js](https://nodejs.org/) (v20+) e [pnpm](https://pnpm.io/) (v9+)
* [Python 3.11+](https://www.python.org/)
* [Docker](https://www.docker.com/) e Docker Compose
* [FFmpeg](https://ffmpeg.org/) (necessário localmente para o worker Python)

### Passo a Passo

**1. Clone o repositório e acesse o diretório:**

```bash
git clone <url-do-repositorio>
cd nebula

```

**2. Configure as variáveis de ambiente:**
Copie o arquivo de exemplo e ajuste as chaves necessárias (especialmente `GROQ_API_KEY` se for utilizar a nuvem).

```bash
cp .env.example .env

```

**3. Suba a Infraestrutura (Banco, Redis, MinIO):**

```bash
docker-compose up -d postgres redis minio

```

**4. Baixe o modelo ONNX para a transcrição:**

```bash
bash scripts/download_models.sh

```

**5. Instale as dependências Node.js:**

```bash
pnpm install

```

**6. Configure o Banco de Dados (Prisma):**

```bash
cd apps/api
pnpm exec prisma db push

```

**7. Execute os serviços localmente:**
Você pode utilizar o Turborepo (configurado no diretório raiz) para rodar a API e o Web simultaneamente:

```bash
pnpm dev

```

Para o worker Python (em um terminal separado):

```bash
cd apps/parakeet_worker
pip install -r requirements.txt
python worker.py

```

---

## 💡 Exemplos de Uso (API)

A comunicação com a API é tipicamente mediada pelo frontend, mas aqui estão exemplos dos fluxos principais:

* **Criar Sessão:** `POST /sessions`
```json
{ "mode": "MEETING", "title": "Reunião de Planejamento" }

```


* **Solicitar Upload de Áudio:** `POST /chunks/presigned-url`
Gera um link seguro (presigned URL) do MinIO para enviar blocos de gravação via PUT.
* **Interagir via SSE (Q&A):** `POST /sessions/:id/question`
```json
{ "question": "Quais foram as decisões tomadas sobre o novo design?" }

```


*A resposta será recebida em formato de Stream (`text/event-stream`).*

---

## 🤝 Contribuição

Contribuições são sempre bem-vindas! Siga os passos abaixo:

1. Faça um *Fork* do projeto
2. Crie uma *Branch* para sua Feature (`git checkout -b feature/IncrivelFeature`)
3. Faça o *Commit* de suas mudanças (`git commit -m 'feat: Adiciona IncrivelFeature'`)
4. Faça o *Push* para a Branch (`git push origin feature/IncrivelFeature`)
5. Abra um *Pull Request*

---

## 📝 Licença

ISC (conforme especificado no pacote do backend). Sinta-se livre para utilizar e modificar para uso pessoal ou estudos.