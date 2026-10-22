from types import SimpleNamespace

from inference.engine import extract_words
from proto.transcriber_pb2 import Segment, Word


def test_preserves_word_timing_and_offset_through_grpc_serialization():
    segment = SimpleNamespace(words=[SimpleNamespace(word='Olá', start=0.125, end=0.375, probability=0.95)])
    words = extract_words(segment, 12000)
    wire = Segment(text='Olá', start_ms=12000, end_ms=13000, words=[Word(**w) for w in words])
    restored = Segment.FromString(wire.SerializeToString())
    assert restored.words[0].start_ms == 12125
    assert restored.words[0].end_ms == 12375
    assert abs(restored.words[0].confidence - 0.95) < 0.001
