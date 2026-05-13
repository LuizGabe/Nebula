# scripts/send_wav.py
import asyncio
import aiohttp
import subprocess
import tempfile
import time
import math
import os
import sys
from pathlib import Path

import dotenv
dotenv.load_dotenv()

API_URL = os.getenv("API_URL", "http://localhost:3333")
CREDENTIALS = {
    "username": os.getenv("TEST_USERNAME", "testuser"),
    "password": os.getenv("TEST_PASSWORD", "senha-segura-123"),
}
CHUNK_DURATION = 5   # segundos
MODE = "MEETING"


def get_wav_duration(path: str) -> float:
    """Retorna duração do arquivo em segundos via ffprobe."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        capture_output=True, text=True, timeout=30,
    )
    return float(result.stdout.strip())


def split_wav(input_path: str, chunk_duration: int, tmp_dir: str) -> list[tuple[str, float, float]]:
    """
    Divide o WAV em chunks de chunk_duration segundos.
    Retorna lista de (path, start_s, end_s).
    """
    total = get_wav_duration(input_path)
    total_chunks = math.ceil(total / chunk_duration)
    chunks = []

    print(
        f"  Duração total: {total:.1f}s → {total_chunks} chunks de {chunk_duration}s")

    for i in range(total_chunks):
        start_s = i * chunk_duration
        end_s = min(start_s + chunk_duration, total)
        out = str(Path(tmp_dir) / f"chunk_{i:04d}.wav")

        cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-ss", str(start_s),
            "-t",  str(chunk_duration),
            "-ac", "1",
            "-ar", "16000",
            "-sample_fmt", "s16",
            out,
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=60)
        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg falhou no chunk {i}: {result.stderr.decode()}")

        chunks.append((out, start_s, end_s))

    return chunks


async def login(session: aiohttp.ClientSession) -> None:
    async with session.post(f"{API_URL}/auth/login", json=CREDENTIALS) as res:
        if res.status == 401:
            async with session.post(f"{API_URL}/auth/register", json=CREDENTIALS) as reg:
                reg.raise_for_status()
                print(f"  Usuário criado: {(await reg.json())['user']['username']}")
        else:
            res.raise_for_status()
            print(f"  Login ok: {(await res.json())['user']['username']}")


async def create_session(session: aiohttp.ClientSession) -> str:
    async with session.post(
        f"{API_URL}/sessions",
        json={"mode": MODE, "title": f"Teste {Path(sys.argv[1]).stem}"},
    ) as res:
        res.raise_for_status()
        session_id = (await res.json())["session"]["id"]
        print(f"  Sessão criada: {session_id}")
        return session_id


async def upload_chunk(
    session:     aiohttp.ClientSession,
    session_id:  str,
    chunk_index: int,
    wav_path:    str,
    start_s:     float,
    end_s:       float,
) -> None:
    # time.sleep(0.5)  # simula tempo entre chunks chegando do front
    # timestamps absolutos em ms — simula o que o front mandaria
    now_ms = int(time.time() * 1000)
    duration_ms = int((end_s - start_s) * 1000)
    ts_end = now_ms
    ts_start = now_ms - duration_ms

    # 1. presigned URL
    async with session.post(
        f"{API_URL}/chunks/presigned-url",
        json={
            "sessionId":   session_id,
            "chunkIndex":  chunk_index,
            "contentType": "audio/wav",
        },
    ) as res:
        res.raise_for_status()
        data = await res.json()
        url = data["url"]

    # 2. upload direto no MinIO
    wav_bytes = Path(wav_path).read_bytes()
    async with session.put(url, data=wav_bytes, headers={"Content-Type": "audio/wav"}) as res:
        if res.status not in (200, 204):
            raise RuntimeError(f"Upload falhou [{res.status}]: {await res.text()}")

    # 3. confirma na API
    async with session.post(
        f"{API_URL}/chunks/confirm",
        json={
            "sessionId":      session_id,
            "chunkIndex":     chunk_index,
            "timestampStart": ts_start,
            "timestampEnd":   ts_end,
        },
    ) as res:
        res.raise_for_status()
        pos = (await res.json())["position"]

    print(f"  [{chunk_index:04d}] {start_s:.1f}s–{end_s:.1f}s "
          f"({len(wav_bytes)/1024:.0f} KB) → fila: {pos}")


async def end_session(session: aiohttp.ClientSession, session_id: str) -> None:
    async with session.patch(
        f"{API_URL}/sessions/{session_id}/end",
        json={},
    ) as res:
        res.raise_for_status()
        print(f"  Sessão encerrada")

async def main() -> None:
    if len(sys.argv) < 2:
        print("Uso: python send_wav.py <caminho/para/saida.wav>")
        sys.exit(1)

    wav_path = sys.argv[1]
    if not Path(wav_path).exists():
        print(f"Arquivo não encontrado: {wav_path}")
        sys.exit(1)

    jar = aiohttp.CookieJar(unsafe=True)

    with tempfile.TemporaryDirectory() as tmp_dir:
        print(f"\n=== DIVIDINDO {wav_path} ===")
        chunks = split_wav(wav_path, CHUNK_DURATION, tmp_dir)

        async with aiohttp.ClientSession(cookie_jar=jar) as session:
            print("\n=== LOGIN ===")
            await login(session)

            print("\n=== CRIAR SESSÃO ===")
            session_id = await create_session(session)

            print(f"\n=== ENVIANDO {len(chunks)} CHUNKS ===")
            for i, (path, start_s, end_s) in enumerate(chunks):
                await upload_chunk(session, session_id, i, path, start_s, end_s)

            print("\n=== ENCERRAR SESSÃO ===")
            await end_session(session, session_id)

    print("\n✓ Concluído")
    print(f"  Verifique no Redis: LRANGE queue:transcription 0 -1")


if __name__ == "__main__":
    asyncio.run(main())
