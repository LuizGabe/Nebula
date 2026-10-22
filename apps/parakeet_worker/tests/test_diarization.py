from inference.diarization import assign_speakers, DiarizationService


def test_assigns_words_and_splits_speaker_turn_without_changing_word_timestamps():
    segments = [{'text': 'Olá Carlos', 'start_ms': 0, 'end_ms': 2000, 'words': [
        {'text': 'Olá', 'start_ms': 0, 'end_ms': 700},
        {'text': 'Carlos', 'start_ms': 1100, 'end_ms': 1800},
    ]}]
    result = assign_speakers(segments, [(0, 1000, 'SPEAKER_00'), (1000, 2000, 'SPEAKER_01')])
    assert len(result) == 2
    assert result[0]['speaker_id'] == 'SPEAKER_00'
    assert result[1]['words'][0]['speaker_id'] == 'SPEAKER_01'
    assert result[1]['words'][0]['start_ms'] == 1100
    assert result[1]['words'][0]['end_ms'] == 1800


def test_unknown_speech_is_not_assigned_a_fabricated_speaker():
    result = assign_speakers([{'text': 'voz', 'start_ms': 3000, 'end_ms': 3500}], [(0, 1000, 'SPEAKER_00')])
    assert result[0]['speaker_id'] is None


def test_disabled_diarization_does_not_import_or_download_models(monkeypatch):
    monkeypatch.setenv('DIARIZATION_ENABLED', 'false')
    segments = [{'text': 'áudio', 'start_ms': 0, 'end_ms': 100}]
    assert DiarizationService().process(b'', segments) is segments
