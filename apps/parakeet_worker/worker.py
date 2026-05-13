"""
worker.py — Consome fila Redis, transcreve chunks via Parakeet, salva no banco.

v2 — process_upload_job usa AudioSplitter (divisão fonética) para nunca enviar
     mais de MAX_CHUNK_SEC ao encoder, eliminando o crash de OOM/ONNX por
     sequências longas demais (ex.: 2433 × 7433 mismatch no self-attn).
"""

from __future__ import annotations
from bullmq import Queue as BullQueue

import asyncio
import json
import logging
import os
import re
import time
import signal
import subprocess
import tempfile
import urllib.parse
from pathlib import Path
from difflib import SequenceMatcher

import asyncpg
import redis.asyncio as aioredis
from miniopy_async import Minio

from transcriber import ParakeetTranscriber
from audio_splitter import AudioSplitter, AudioChunk, SplitPlan
import dotenv

current = Path(__file__).resolve()

for parent in [current] + list(current.parents):
    env_path = parent / ".env"
    if env_path.exists():
        dotenv.load_dotenv(env_path)
        break

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("worker")

# ── config via env ────────────────────────────────────────────────────────────
DATABASE_URL            = os.environ["DATABASE_URL"]
PARAGRAPH_GAP_MEETING   = float(os.environ.get("PARAGRAPH_GAP_MEETING", "1.2"))
PARAGRAPH_GAP_CLASS     = float(os.environ.get("PARAGRAPH_GAP_CLASS",   "2.0"))
REDIS_URL               = os.environ["REDIS_URL"]
MINIO_ENDPOINT          = os.environ["MINIO_ENDPOINT"]
MINIO_ACCESS            = os.environ["MINIO_ACCESS_KEY"]
MINIO_SECRET            = os.environ["MINIO_SECRET_KEY"]
MINIO_BUCKET            = os.environ.get("MINIO_BUCKET", "transcriber")
MINIO_SECURE            = os.environ.get("MINIO_SECURE", "false").lower() == "true"
_redis_parsed           = urllib.parse.urlparse(REDIS_URL)
REDIS_HOST              = _redis_parsed.hostname or "localhost"
REDIS_PORT              = _redis_parsed.port or 6379
QUEUE_KEY               = "queue:transcription"
BULL_POST_PROCESSING_QUEUE = "post-processing"

# ── config de divisão de uploads ──────────────────────────────────────────────
# Limite máximo de áudio por chamada ao encoder (segurança OOM)
UPLOAD_MAX_CHUNK_SEC  = float(os.environ.get("UPLOAD_MAX_CHUNK_SEC",  "55.0"))
# Overlap de contexto entre chunks adjacentes (segundos)
UPLOAD_OVERLAP_SEC    = float(os.environ.get("UPLOAD_OVERLAP_SEC",    "2.0"))
# Limiar de silêncio para detecção fonética (dBFS)
UPLOAD_SILENCE_DB     = float(os.environ.get("UPLOAD_SILENCE_DB",     "-35.0"))
# Duração mínima de silêncio para ser ponto de corte (segundos)
UPLOAD_SILENCE_MIN    = float(os.environ.get("UPLOAD_SILENCE_MIN",    "0.3"))
# Quantos chunks rodam em paralelo (CPU: 2 é o sweet spot)
UPLOAD_CONCURRENCY    = int(os.environ.get("UPLOAD_CONCURRENCY",      "2"))
# ─────────────────────────────────────────────────────────────────────────────

# ── graceful shutdown ─────────────────────────────────────────────────────────
shutdown_event = asyncio.Event()


def _signal_handler(sig, _frame):
    log.info(f"[worker] recebeu {signal.Signals(sig).name}, encerrando…")
    shutdown_event.set()


signal.signal(signal.SIGINT,  _signal_handler)
signal.signal(signal.SIGTERM, _signal_handler)
# ─────────────────────────────────────────────────────────────────────────────


# ── remoção de overlap textual ────────────────────────────────────────────────
def remove_overlap(previous_text: str, current_text: str) -> str:
    """
    Remove do início de current_text palavras que já apareceram no fim de previous_text
    (produto do overlap de áudio entre chunks adjacentes).
    """
    if not previous_text:
        return current_text

    prev_words = previous_text.split()
    curr_words = current_text.split()

    def norm(w: str) -> str:
        return re.sub(r"[.,!?;:\-–—\"'""'']", "", w.lower())

    prev_norm = [norm(w) for w in prev_words]
    curr_norm = [norm(w) for w in curr_words]

    best_cut  = 0
    max_window = min(len(prev_norm), len(curr_norm), 80)

    for window in range(max_window, 2, -1):
        tail  = prev_norm[-window:]
        head  = curr_norm[:window]
        ratio = SequenceMatcher(None, tail, head).ratio()

        if ratio >= 0.75:
            best_cut = window
            log.info(
                f"[overlap] removendo {window} palavras (similaridade {ratio:.2f})"
            )
            break

    if best_cut == 0:
        return current_text

    result = " ".join(curr_words[best_cut:]).strip()
    return result if result else current_text


# ── áudio ─────────────────────────────────────────────────────────────────────
def concat_wav_files(paths: list[str], output: str) -> str:
    """Concatena N arquivos WAV num único arquivo via ffmpeg concat."""
    list_file = output + ".list.txt"
    with open(list_file, "w") as f:
        for p in paths:
            f.write(f"file '{p}'\n")

    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
           "-i", list_file, "-c", "copy", output]
    result = subprocess.run(cmd, capture_output=True, timeout=60)

    Path(list_file).unlink(missing_ok=True)

    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg concat erro: {result.stderr.decode(errors='replace')}"
        )
    return output


def convert_to_mono_wav(src: str) -> str:
    """Converte qualquer áudio para WAV mono 16 kHz."""
    dst = src + ".wav"
    cmd = ["ffmpeg", "-y", "-i", src,
           "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", "-vn", dst]
    result = subprocess.run(cmd, capture_output=True, timeout=120)

    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg erro: {result.stderr.decode(errors='replace')}"
        )
    return dst


def get_audio_duration(wav_path: str) -> float:
    """Retorna a duração em segundos de um WAV via ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        wav_path,
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffprobe erro: {result.stderr.decode(errors='replace')}"
        )
    return float(result.stdout.strip())


def slice_wav(src: str, start_sec: float, duration_sec: float, dst: str) -> str:
    """
    Extrai um trecho do WAV via ffmpeg seek preciso.
    Usa -ss antes de -i para seek rápido e -t para a duração exata.
    """
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start_sec),
        "-t",  str(duration_sec),
        "-i",  src,
        "-c",  "copy",
        dst,
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=60)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg slice erro: {result.stderr.decode(errors='replace')}"
        )
    return dst


# ── banco ─────────────────────────────────────────────────────────────────────
async def save_transcript_blocks(
    pool: asyncpg.Pool,
    session_id: str,
    chunk_index: int,
    full_text: str,
    timestamp_start_ms: int,
    timestamp_end_ms: int,
    segments: list[dict],
) -> None:
    """Salva o texto completo em Transcript e cada segmento em TranscriptBlock."""
    if not full_text.strip():
        log.info(f"[db] chunk {chunk_index:04d} ignorado — transcrição vazia")
        return

    # timestamp_start_ms / timestamp_end_ms são inteiros (ms desde início do áudio)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO transcripts (id, "sessionId", "chunkIndex", text,
                                         "timestampStart", "timestampEnd", "createdAt")
                VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())
                ON CONFLICT ("sessionId", "chunkIndex") DO UPDATE SET text = EXCLUDED.text
                """,
                session_id, chunk_index, full_text.strip(),
                timestamp_start_ms, timestamp_end_ms,
            )

            for i, seg in enumerate(segments):
                block_index = chunk_index * 1000 + i
                # seg["start"] e seg["end"] já são int ms desde o início do áudio
                await conn.execute(
                    """
                    INSERT INTO transcript_blocks
                        (id, "sessionId", "blockIndex", "rawText",
                         "timestampStart", "timestampEnd", "createdAt")
                    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())
                    ON CONFLICT DO NOTHING
                    """,
                    session_id, block_index, seg["text"].strip(),
                    seg["start"], seg["end"],
                )

    log.info(
        f"[db] chunk {chunk_index:04d} salvo — "
        f"{len(segments)} bloco(s) [{timestamp_start_ms}ms → {timestamp_end_ms}ms]"
    )


async def get_previous_transcript(
    pool: asyncpg.Pool,
    session_id: str,
    chunk_index: int,
) -> str | None:
    row = await pool.fetchrow(
        """SELECT text FROM transcripts
           WHERE "sessionId"=$1 AND "chunkIndex"=$2""",
        session_id, chunk_index - 1,
    )
    return row["text"] if row else None


# ── MinIO ─────────────────────────────────────────────────────────────────────
async def download_chunk(minio: Minio, key: str, dest: str) -> str:
    await minio.fget_object(MINIO_BUCKET, key, dest)
    return dest


async def trigger_post_processing(
    session_id: str, triggered_by: str = "transcription_done"
) -> None:
    """Enfileira job de geração de documento diretamente no BullMQ via Redis."""
    try:
        queue = BullQueue(
            BULL_POST_PROCESSING_QUEUE,
            {"connection": {"host": REDIS_HOST, "port": REDIS_PORT}},
        )

        job_id = (
            f"session-{session_id}"
            if triggered_by != "user_reprocess"
            else f"reprocess-{session_id}-{int(time.time())}"
        )

        await queue.add(
            "generate-document",
            {"sessionId": session_id, "triggeredBy": triggered_by},
            {"jobId": job_id},
        )
        await queue.close()
        log.info(f"[bullmq] job enfileirado: sessão={session_id} jobId={job_id}")

    except Exception as e:
        log.error(f"[bullmq] falha ao enfileirar job: {e}")


# ── transcrição de chunk (sync — roda em executor) ────────────────────────────
def _transcribe_chunk_sync(
    transcriber: ParakeetTranscriber,
    chunk: AudioChunk,
    gap_sec: float,
) -> dict:
    """
    Transcreve um AudioChunk de forma síncrona para não bloquear o event loop.

    - audio_offset_sec = chunk.audio_start  → timestamps absolutos no áudio original
    - content_start_sec / content_end_sec   → descarta overlap pré/pós no arquivo WAV
      (são relativos ao início do arquivo WAV, não ao áudio original)
    """
    return transcriber.transcribe(
        audio_path        = chunk.path,
        audio_offset_sec  = chunk.audio_start,   # faz timestamps absolutos
        gap_sec           = gap_sec,
        content_start_sec = chunk.pre_overlap_sec if chunk.has_overlap_pre  else None,
        content_end_sec   = (chunk.audio_duration - chunk.post_overlap_sec)
                            if chunk.has_overlap_post else None,
    )


# ── processamento de job de upload ─────────────────────────────────────────────
async def process_upload_job(
    job: dict,
    transcriber: ParakeetTranscriber,
    minio: Minio,
    pool: asyncpg.Pool,
) -> None:
    """
    Processa upload de áudio completo (mp3, wav, m4a, ogg, etc).

    Pipeline:
        1. Download do MinIO
        2. Conversão para WAV mono 16kHz
        3. AudioSplitter: divisão fonética em chunks <= UPLOAD_MAX_CHUNK_SEC
           com UPLOAD_OVERLAP_SEC de contexto compartilhado entre adjacentes
        4. Transcrição em lotes de UPLOAD_CONCURRENCY chunks paralelos
        5. Remoção de overlap textual entre chunks adjacentes
        6. Persistência: uma linha em `transcripts` + blocos em `transcript_blocks`
        7. Sessão marcada como ENDED
    """
    session_id = job["sessionId"]
    key        = job["key"]
    filename   = job.get("filename", key.split("/")[-1])
    mode       = job.get("mode", "MEETING")
    gap_sec    = PARAGRAPH_GAP_MEETING if mode == "MEETING" else PARAGRAPH_GAP_CLASS

    log.info(f"[upload] sessão={session_id} arquivo={filename} mode={mode}")

    loop         = asyncio.get_running_loop()
    tmp_files: list[str] = []
    plan: SplitPlan | None = None

    splitter = AudioSplitter(
        max_chunk_sec   = UPLOAD_MAX_CHUNK_SEC,
        overlap_sec     = UPLOAD_OVERLAP_SEC,
        silence_db      = UPLOAD_SILENCE_DB,
        silence_min_sec = UPLOAD_SILENCE_MIN,
    )

    try:
        # ── 1. Download ────────────────────────────────────────────────────────
        ext = Path(filename).suffix or ".audio"
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
            raw_path = f.name
        tmp_files.append(raw_path)

        await download_chunk(minio, key, raw_path)
        log.info(f"[upload] download ok ({Path(raw_path).stat().st_size:,} bytes)")

        # ── 2. Conversão para WAV mono 16kHz ───────────────────────────────────
        wav_path = convert_to_mono_wav(raw_path)
        tmp_files.append(wav_path)

        total_sec = get_audio_duration(wav_path)
        log.info(f"[upload] duração total: {total_sec:.1f}s")

        # ── 3. Divisão fonética ────────────────────────────────────────────────
        # O splitter cria os arquivos de chunk em um diretório temporário próprio.
        # Usamos NamedTemporaryFile apenas para obter um tmpdir path único.
        tmp_dir = tempfile.mkdtemp(prefix="parakeet_")
        # tmp_dir será limpo via splitter.cleanup(plan) no finally
        plan = splitter.split(wav_path, tmp_dir=tmp_dir)

        log.info(
            f"[upload] {len(plan.chunks)} chunk(s) | "
            f"silêncios={plan.silence_count} forçados={plan.forced_cuts} "
            f"overlap={UPLOAD_OVERLAP_SEC}s concurrency={UPLOAD_CONCURRENCY}"
        )

        # ── 4. Transcrição em lotes paralelos ──────────────────────────────────
        # Resultados indexados por chunk.index para garantir ordem na persistência
        transcription_results: dict[int, dict] = {}

        for batch_start in range(0, len(plan.chunks), UPLOAD_CONCURRENCY):
            batch = plan.chunks[batch_start : batch_start + UPLOAD_CONCURRENCY]

            tasks = [
                loop.run_in_executor(
                    None,
                    _transcribe_chunk_sync,
                    transcriber,
                    chunk,
                    gap_sec,
                )
                for chunk in batch
            ]

            batch_results = await asyncio.gather(*tasks, return_exceptions=True)

            for chunk, result in zip(batch, batch_results):
                if isinstance(result, Exception):
                    # chunk falhou — loga mas não derruba o job inteiro
                    log.error(
                        f"[upload] chunk {chunk.index:04d} "
                        f"[{chunk.content_start:.1f}s→{chunk.content_end:.1f}s] "
                        f"FALHOU: {result}",
                        exc_info=False,
                    )
                    # Armazena resultado vazio para manter consistência de índices
                    transcription_results[chunk.index] = {
                        "text": "", "segments": [], "elapsed": 0.0,
                        "_error": str(result),
                    }
                else:
                    log.info(
                        f"[upload] chunk {chunk.index:04d} "
                        f"[{chunk.content_start:.1f}s→{chunk.content_end:.1f}s] "
                        f"elapsed={result['elapsed']}s "
                        f"seg={len(result['segments'])} "
                        f"preview={result['text'][:60]!r}"
                    )
                    transcription_results[chunk.index] = result

        # ── 5. Remoção de overlap textual e persistência ───────────────────────
        previous_text: str | None = None

        for chunk in plan.chunks:
            result    = transcription_results.get(chunk.index)
            full_text = result["text"] if result else ""
            segments  = result["segments"] if result else []

            if not full_text.strip():
                log.info(f"[upload] chunk {chunk.index:04d} vazio, pulando")
                previous_text = None
                continue

            clean_text = remove_overlap(previous_text, full_text) if previous_text else full_text
            previous_text = full_text  # guarda texto bruto para próxima comparação

            if not clean_text.strip():
                log.info(
                    f"[upload] chunk {chunk.index:04d} vazio após remoção de overlap, pulando"
                )
                continue

            # timestamps em ms desde o início do áudio (inteiros puros)
            slice_start_ms = int(chunk.content_start * 1000)
            slice_end_ms   = int(chunk.content_end   * 1000)

            await save_transcript_blocks(
                pool,
                session_id,
                chunk_index=chunk.index,
                full_text=clean_text,
                timestamp_start_ms=slice_start_ms,
                timestamp_end_ms=slice_end_ms,
                segments=segments,
            )

        # ── 6. Fecha a sessão ──────────────────────────────────────────────────
        await pool.execute(
            """UPDATE recording_sessions SET status='ENDED', "endedAt"=now()
               WHERE id=$1 AND status='ACTIVE'""",
            session_id,
        )
        log.info(
            f"[upload] sessão {session_id} encerrada — "
            f"{len(plan.chunks)} chunk(s) processado(s)"
        )

    finally:
        # Limpa arquivos temporários de chunks (o splitter sabe quais são os seus)
        if plan is not None:
            # Não limpa chunk único que aponta para o wav original
            if len(plan.chunks) > 1 or (
                plan.chunks and plan.chunks[0].path != wav_path
            ):
                splitter.cleanup(plan)

        # Limpa arquivos temporários do worker
        for f in tmp_files:
            Path(f).unlink(missing_ok=True)

        # Remove tmpdir se existir e estiver vazio
        try:
            import shutil
            if "tmp_dir" in locals():
                shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


# ── processamento de job de chunk (streaming) ─────────────────────────────────
async def process_chunk_job(
    job: dict,
    transcriber: ParakeetTranscriber,
    minio: Minio,
    pool: asyncpg.Pool,
) -> None:
    """Processa chunk de gravação em streaming (comportamento atual)."""
    session_id      = job["sessionId"]
    chunk_index     = job["chunkIndex"]
    key             = job["key"]
    timestamp_start = job["timestampStart"]
    timestamp_end   = job["timestampEnd"]
    mode            = job.get("mode", "MEETING")
    gap_sec         = PARAGRAPH_GAP_MEETING if mode == "MEETING" else PARAGRAPH_GAP_CLASS

    log.info(f"[chunk] sessão={session_id} chunk={chunk_index:04d} mode={mode}")

    tmp_files: list[str] = []
    try:
        with tempfile.NamedTemporaryFile(suffix=".raw", delete=False) as f:
            raw_path = f.name
        tmp_files.append(raw_path)

        await download_chunk(minio, key, raw_path)
        current_wav = convert_to_mono_wav(raw_path)
        tmp_files.append(current_wav)

        audio_to_transcribe = current_wav
        previous_text: str | None = None

        if chunk_index > 0:
            prev_key = (
                f"sessions/{session_id}/chunks/"
                f"{str(chunk_index - 1).zfill(4)}.webm"
            )
            with tempfile.NamedTemporaryFile(suffix=".raw", delete=False) as f:
                prev_raw = f.name
            tmp_files.append(prev_raw)

            try:
                await download_chunk(minio, prev_key, prev_raw)
                prev_wav = convert_to_mono_wav(prev_raw)
                tmp_files.append(prev_wav)

                with tempfile.NamedTemporaryFile(suffix=".concat.wav", delete=False) as f:
                    concat_path = f.name
                tmp_files.append(concat_path)

                audio_to_transcribe = concat_wav_files(
                    [prev_wav, current_wav], concat_path
                )
            except Exception as e:
                log.warning(f"[overlap] chunk anterior indisponível: {e}")

            previous_text = await get_previous_transcript(pool, session_id, chunk_index)

        result    = transcriber.transcribe(audio_to_transcribe, gap_sec=gap_sec)
        full_text = result["text"]
        segments  = result["segments"]

        log.info(f"[chunk] {result['elapsed']}s → {len(segments)} seg → {full_text[:80]!r}")

        if not full_text.strip():
            return

        clean_text = remove_overlap(previous_text, full_text) if previous_text else full_text
        if not clean_text.strip():
            return

        await save_transcript_blocks(
            pool, session_id, chunk_index,
            clean_text, timestamp_start, timestamp_end, segments,
        )

    finally:
        for f in tmp_files:
            Path(f).unlink(missing_ok=True)


def _transcribe_slice_sync(
    transcriber: ParakeetTranscriber,
    slice_path: str,
    offset_sec: float,
    gap_sec: float,
) -> dict:
    """
    Mantido para compatibilidade com jobs antigos que possam estar em fila.
    Usa a nova assinatura do transcriber.
    """
    return transcriber.transcribe(slice_path, audio_offset_sec=offset_sec, gap_sec=gap_sec)


# ── dispatcher ────────────────────────────────────────────────────────────────
async def process_job(
    job: dict,
    transcriber: ParakeetTranscriber,
    minio: Minio,
    pool: asyncpg.Pool,
) -> None:
    """Dispatcher — roteia para chunk ou upload."""
    job_type = job.get("type", "chunk")

    if job_type == "upload":
        await process_upload_job(job, transcriber, minio, pool)
        await trigger_post_processing(
            session_id=job["sessionId"], triggered_by="transcription_done"
        )
    else:
        await process_chunk_job(job, transcriber, minio, pool)


# ── loop principal ────────────────────────────────────────────────────────────
async def main() -> None:
    log.info("[worker] iniciando…")

    transcriber = ParakeetTranscriber()

    minio = Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS,
        secret_key=MINIO_SECRET,
        secure=MINIO_SECURE,
    )

    pool  = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    redis = await aioredis.from_url(REDIS_URL, decode_responses=True)

    log.info(f"[worker] aguardando jobs em '{QUEUE_KEY}'…")

    while not shutdown_event.is_set():
        try:
            item = await redis.brpop(QUEUE_KEY, timeout=5)

            if item is None:
                continue

            _, raw = item
            job    = json.loads(raw)

            await process_job(job, transcriber, minio, pool)

        except Exception as e:
            log.error(f"[worker] erro ao processar job: {e}", exc_info=True)

    log.info("[worker] encerrando conexões…")
    await pool.close()
    await redis.aclose()
    log.info("[worker] encerrado.")


if __name__ == "__main__":
    asyncio.run(main())