from enum import Enum, auto

class EventType(str, Enum):
    # Streaming
    CHUNK_RECEIVED             = "CHUNK_RECEIVED"
    CHUNK_QUEUED               = "CHUNK_QUEUED"
    CHUNK_TRANSCRIPTION_STARTED = "CHUNK_TRANSCRIPTION_STARTED"
    CHUNK_TRANSCRIBED          = "CHUNK_TRANSCRIBED"
    CHUNK_FAILED               = "CHUNK_FAILED"

    # Batch
    UPLOAD_RECEIVED            = "UPLOAD_RECEIVED"
    UPLOAD_QUEUED              = "UPLOAD_QUEUED"
    UPLOAD_TRANSCRIPTION_STARTED = "UPLOAD_TRANSCRIPTION_STARTED"
    UPLOAD_TRANSCRIBED         = "UPLOAD_TRANSCRIBED"
    UPLOAD_FAILED              = "UPLOAD_FAILED"

    # Pós-processamento (emitidos apenas quando enfileiramos)
    DOCUMENT_QUEUED            = "DOCUMENT_QUEUED"
    # Os demais (GENERATING, READY, SKIPPED, FAILED) serão emitidos pelo consumidor da fila