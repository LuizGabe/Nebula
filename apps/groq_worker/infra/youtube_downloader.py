from __future__ import annotations

import asyncio
import logging
import math
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, urlparse

log = logging.getLogger("infra.youtube_downloader")


class YouTubeError(ValueError):
    pass


def normalize_youtube_url(value: str) -> str:
    try:
        url = urlparse(value.strip())
        if url.scheme not in {"http", "https"} or url.username or url.password or url.port:
            raise ValueError()
        host = (url.hostname or "").lower()
        video_id = None
        if host in {"youtu.be", "www.youtu.be"}:
            match = re.fullmatch(r"/([\w-]{11})/?", url.path, re.ASCII)
            video_id = match[1] if match else None
        elif host in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
            if url.path == "/watch":
                video_id = parse_qs(url.query).get("v", [None])[0]
            else:
                match = re.fullmatch(r"/shorts/([\w-]{11})/?", url.path, re.ASCII)
                video_id = match[1] if match else None
        if not video_id or not re.fullmatch(r"[\w-]{11}", video_id, re.ASCII):
            raise ValueError()
        return f"https://www.youtube.com/watch?v={video_id}"
    except (ValueError, TypeError):
        raise YouTubeError("URL do YouTube invalida") from None


def validate_metadata(info: dict, max_minutes: int) -> float:
    if info.get("_type") in {"playlist", "multi_video"} or info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming"}:
        raise YouTubeError("Envie um video concluido. Lives e playlists nao sao suportadas.")
    if info.get("availability") in {"private", "premium_only", "subscriber_only", "needs_auth"} or (info.get("age_limit") or 0) >= 18:
        raise YouTubeError("Este video e privado ou protegido e nao pode ser importado.")
    duration = info.get("duration")
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
        raise YouTubeError("Nao foi possivel verificar a duracao do video. Escolha um video concluido.")
    if duration > max_minutes * 60:
        raise YouTubeError(f"O vídeo excede o limite de duração permitido de {max_minutes} minutos")
    return float(duration)


@dataclass(frozen=True)
class DownloadedYouTubeAudio:
    path: Path
    duration_seconds: float
    title: str


class YouTubeDownloader:
    async def download(self, url: str, max_minutes: int, directory: Path, progress) -> DownloadedYouTubeAudio:
        url = normalize_youtube_url(url)
        for attempt in range(1, 4):
            await progress({"stage": "metadata", "attempt": attempt, "message": f"Verificando video do YouTube (tentativa {attempt}/3)"})
            loop = asyncio.get_running_loop()

            def report(payload):
                asyncio.run_coroutine_threadsafe(progress(payload), loop).result(timeout=10)

            try:
                return await asyncio.to_thread(self._attempt, url, max_minutes, directory / str(attempt), attempt, report)
            except YouTubeError:
                raise
            except Exception as exc:
                log.warning("YouTube extraction attempt=%s failed: %s", attempt, exc)
                text = str(exc).lower()
                if any(marker in text for marker in ("private video", "video unavailable", "video is unavailable", "has been removed", "age-restricted", "confirm your age", "members-only", "copyright")):
                    raise YouTubeError("Este video e privado, protegido ou indisponivel e nao pode ser importado.") from exc
                if attempt == 3:
                    raise YouTubeError("Nao foi possivel baixar o audio do YouTube apos 3 tentativas. O servico pode estar bloqueando o acesso; tente novamente mais tarde.") from exc
                await asyncio.sleep(attempt)
        raise AssertionError("unreachable")

    def _attempt(self, url: str, max_minutes: int, directory: Path, attempt: int, progress) -> DownloadedYouTubeAudio:
        import time
        from yt_dlp import YoutubeDL

        directory.mkdir(parents=True, exist_ok=True)
        last_update = 0.0

        def download_progress(data):
            nonlocal last_update
            now = time.monotonic()
            if now - last_update < 1 and data.get("status") != "finished":
                return
            last_update = now
            total = data.get("total_bytes") or data.get("total_bytes_estimate")
            percent = min(100, round(data.get("downloaded_bytes", 0) / total * 100)) if total else None
            progress({"stage": "download", "attempt": attempt, "percent": percent, "message": "Baixando audio do YouTube"})

        def metadata_filter(info, *, incomplete=False):
            if not incomplete:
                validate_metadata(info, max_minutes)
            return None

        formats = ("bestaudio[ext=m4a]/bestaudio", "bestaudio[ext=webm]/bestaudio", "worstaudio")
        agents = (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
        )
        options = {
            "format": formats[attempt - 1], "http_headers": {"User-Agent": agents[attempt - 1]},
            "outtmpl": str(directory / "audio.%(ext)s"), "noplaylist": True,
            "quiet": True, "no_warnings": True, "logger": log, "cachedir": False,
            "retries": 0, "fragment_retries": 0, "extractor_retries": 0, "socket_timeout": 20,
            "js_runtimes": {"node": {}}, "max_filesize": 1000 * 1024 * 1024,
            "match_filter": metadata_filter, "progress_hooks": [download_progress],
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "64"}],
        }
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=False)
            if not info:
                raise YouTubeError("O video nao esta disponivel para importacao.")
            duration = validate_metadata(info, max_minutes)
            progress({"stage": "download", "durationSeconds": duration, "title": str(info.get("title") or "").strip()[:120], "attempt": attempt, "message": "Baixando audio do YouTube"})
            downloader.process_ie_result(info, download=True)
        path = directory / "audio.mp3"
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError("O download nao produziu um arquivo de audio")
        return DownloadedYouTubeAudio(path, duration, str(info.get("title") or "Video do YouTube"))
