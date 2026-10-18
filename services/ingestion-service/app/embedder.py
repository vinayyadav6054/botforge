from fastembed import TextEmbedding

from . import config

_model: TextEmbedding | None = None


def get_model() -> TextEmbedding:
    global _model
    if _model is None:
        _model = TextEmbedding(model_name=config.EMBEDDING_MODEL)
    return _model


def embed(texts: list[str]):
    return list(get_model().embed(texts))
