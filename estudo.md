Sua análise inicial foi cirúrgica, e a sua proposta de arquitetura unificada faz total sentido. Você identificou o coração do problema: **falta padronização nos canais de retorno e no modelo de processamento do Worker.**

Atualmente, sua aplicação sofre com uma "crise de identidade" de protocolos, onde o backend e o worker tentam adivinhar por onde falar. Vamos desenhar a **melhor solução arquitetural**, focando em simplicidade, manutenibilidade e no princípio de que o desenvolvedor não deve ter carga cognitiva para lembrar "qual protocolo usar em qual rota".

---

## 🎯 O Diagnóstico & A Filosofia de Design

Para resolver isso de vez, precisamos separar claramente duas coisas:

1. **O Canal de Entrada (Ingress):** Pode ser diferente (Fila para Batch, gRPC para Streaming), porque a natureza dos dados é diferente (um arquivo estático vs. um fluxo de áudio ao vivo).
2. **O Canal de Saída (Egress/Eventos):** **Deve ser único.** Todo e qualquer resultado de transcrição (seja chunk de lote ou palavra do streaming) deve convergir para o **Redis Pub/Sub**.

O seu backend Node já é excelente em ouvir o Redis e cuspir para o Frontend via WebSocket. Portanto, o Worker não deve tentar falar gRPC de volta para o Node para relatar progresso, e o Node não deve ler streams gRPC complexos se já usa Pub/Sub.

---

## 🏗️ A Arquitetura Proposta: Unified Egress

### 1. Fluxo de Upload (Batch)

* **Entrada:** S3 Webhook → Node → Fila (BullMQ) → Python Worker.
* **Processamento:** O Worker divide o áudio em chunks (ex: 15s) usando o `AudioSplitter`.
* **Saída Progressiva (Preview):** A cada chunk processado, o Worker faz duas coisas em paralelo:
1. Salva o trecho no Banco de Dados (Persistência).
2. Publica no **Redis Pub/Sub** (ex: `session:{id}:events`) com o tipo `UPLOAD_TRANSCRIBING`.


* **Fim do Job:** Worker atualiza o status para `ENDED` e publica o evento final no Redis. O Frontend recebe tudo em tempo real via WebSocket.

### 2. Fluxo de Streaming (Live)

* **Entrada:** Frontend (Audio PCM) → WebSocket → Node Backend (Proxy) → gRPC Bidirecional → Python Worker.
* **Processamento:** O Worker processa os buffers de áudio em tempo real.
* **Saída:** Em vez de devolver o texto pelo stream gRPC de volta e fazer o Node publicar, o **próprio Worker publica direto no Redis Pub/Sub** (no mesmo canal `session:{id}:events`).
* **Persistência:** O Worker salva os segmentos no banco de dados conforme eles se estabilizam (fim de frases).

> 💡 **Por que essa é a melhor solução?** > Porque o seu backend Node passa a ter **uma única responsabilidade** para atualizações em tempo real: ele assina o canal `session:{id}:events` no Redis e repassa o payload JSON idêntico para o WebSocket do frontend. Não importa se o evento veio de um arquivo de 1 hora ou de um microfone ao vivo.

---

## 🛠️ Plano de Ação & Refatoração do Código

Para aplicar isso no código que você analisou, aqui está o que precisamos alterar:

### Passo 1: O Unificador (`infra/redis_publisher.py`)

Criar um cliente Redis assíncrono no Worker Python. Ambos os emitters (`StreamResultEmitter` e `BatchResultEmitter`) vão herdar ou utilizar esse cara.

```python
# python_worker/infra/redis_publisher.py
import json
import redis.asyncio as aioredis

class RedisPublisher:
    def __init__(self, redis_url: str):
        self.redis = aioredis.from_url(redis_url)

    async def publish_event(self, session_id: str, event_type: str, payload: dict):
        channel = f"session:{session_id}:events"
        message = {
            "type": event_type,
            "sessionId": session_id,
            "data": payload
        }
        await self.redis.publish(channel, json.dumps(message))

```

### Passo 2: Corrigir o Bug do Evento Inicial no Batch

No `BatchHandler._process_job`, logo após baixar o arquivo do S3 e validar, disparar o evento de início.

```python
async def _process_job(self, job):
    session_id = job.data["session_id"]
    
    # 1. Emitir evento de início imediatamente
    await self.redis_publisher.publish_event(
        session_id, 
        "UPLOAD_TRANSCRIBING", 
        {"status": "processing", "message": "Downloading and splitting audio..."}
    )
    
    # 2. Download e conversão
    audio_path = await self.download_file(job.data["s3_url"])
    pcm_audio = await self._convert_to_pcm(audio_path)
    
    # 3. Chunking com AudioSplitter (Adeus processamento monolítico!)
    # Configurar chunks de 15 segundos para um preview fluido
    splitter = AudioSplitter(chunk_size_secs=15) 
    chunks = splitter.split(pcm_audio)
    
    for chunk in chunks:
        # Transcreve apenas o pedaço de 15s
        result = await self.transcriber.transcribe(chunk) 
        
        # Salva no DB e publica no Redis via BatchResultEmitter
        await self.emitter.emit_segment(session_id, result) 
        
    await self.finalize(session_id)

```

### Passo 3: Ajustar os Emitters

* **`BatchResultEmitter`:** No método `emit_segment`, além do `db.save_transcript(...)`, adicione a chamada para o `redis_publisher.publish_event`.
* **`StreamResultEmitter`:** Remova a fila gRPC de retorno do loop de envio para eventos de texto (ou mantenha o gRPC apenas se precisar de controle de contra-pressão/backpressure, mas use o Redis para espalhar os eventos de texto). Se o Worker publicar direto no Redis, o fluxo de streaming fica idêntico ao de batch.

---

## 🧠 Resumo dos Benefícios

* **Carga cognitiva zero:** Você não precisa lembrar de rotas. Entrou por lote? Vai pro BullMQ. Entrou ao vivo? Vai pro gRPC. **Saiu? Sempre vai pro Redis Pub/Sub.**
* **Preview Funcional:** O uso do `AudioSplitter` quebrando o arquivo em blocos menores (recomendo **15 segundos** para um bom balanço entre contexto para o Whisper e velocidade de preview) envia o texto para o usuário enquanto o resto do arquivo ainda está na fila de processamento.
* **Backend Node "Burro" (Lightweight):** Seu backend não precisa processar streams complexos de gRPC de volta, ele apenas escuta o Redis (que ele já sabe fazer) e joga para o cliente final.

Como você prefere seguir agora? Quer que eu monte a estrutura de dados (payload JSON) ideal para conversarmos com o seu dual-write do Prisma, ou quer focar no código de refatoração do `BatchHandler` com o splitter?