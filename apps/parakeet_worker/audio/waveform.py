"""Bounded peak generation on the original audio timeline, outside the event loop."""
from __future__ import annotations

import array
import os
import subprocess
import tempfile
import threading
from pathlib import Path


def waveform_from_audio(data: bytes, filename: str) -> tuple[list[list[float]], int]:
    # A file also supports seek-dependent MP4/M4A containers.
    suffix = Path(filename).suffix[:12] or '.audio'
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as source:
        source.write(data)
        path = source.name
    try:
        with tempfile.TemporaryFile() as errors:
            proc = subprocess.Popen([
                'ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path,
                '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1',
            ], stdout=subprocess.PIPE, stderr=errors)
            watchdog = threading.Timer(300, proc.kill)
            watchdog.daemon = True
            watchdog.start()
            peaks: list[float] = []
            count = 0
            bucket = 1600
            try:
                while True:
                    block = proc.stdout.read(bucket * 2)
                    if not block:
                        break
                    samples = array.array('h', block[:len(block) // 2 * 2])
                    count += len(samples)
                    peaks.append(max((abs(v) for v in samples), default=0) / 32768)
                    if len(peaks) >= 4000:
                        peaks = [max(peaks[i:i + 2]) for i in range(0, len(peaks), 2)]
                        bucket *= 2
                if proc.wait(timeout=30) != 0:
                    raise RuntimeError('Falha ao gerar picos de áudio')
            finally:
                watchdog.cancel()
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
                proc.stdout.close()
            return [peaks], round(count / 16)
    finally:
        os.unlink(path)
