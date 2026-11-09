from . import config, gemini_embed

_model = None


def get_model():
    """Loads the local model once (EMBEDDING_PROVIDER=local); nothing to load for Gemini."""
    global _model
    if config.EMBEDDING_PROVIDER == "gemini":
        return None
    if _model is None:
        from fastembed import TextEmbedding   # imported lazily: not installed on Gemini-only hosts
        _model = TextEmbedding(model_name=config.EMBEDDING_MODEL)
    return _model


def embed(texts: list[str]):
    if config.EMBEDDING_PROVIDER == "gemini":
        return gemini_embed.embed(texts, "RETRIEVAL_DOCUMENT")
    return list(get_model().embed(texts))
