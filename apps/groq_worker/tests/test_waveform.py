import io
import shutil
import wave

import pytest

from audio.waveform import waveform_from_audio


@pytest.mark.skipif(not shutil.which('ffmpeg'), reason='ffmpeg required for audio integration')
def test_peak_generation_preserves_original_duration_and_bounds_long_audio():
    source = io.BytesIO()
    with wave.open(source, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b'\x00\x20' * (16000 * 401))
    peaks, duration_ms = waveform_from_audio(source.getvalue(), 'original.wav')
    assert duration_ms == 401000
    assert 0 < len(peaks[0]) <= 4000
    assert all(abs(value - 0.25) < 0.001 for value in peaks[0])
