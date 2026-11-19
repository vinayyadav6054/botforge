from . import config, gemini_embed, remote_embed, static_embed

_model = None


def get_model():
    """Loads the local model once (EMBEDDING_PROVIDER=local or model2vec); nothing to load for Gemini
    or when the chat service makes the vectors (EMBED_SERVICE_URL)."""
    global _model
    if config.EMBEDDING_PROVIDER == "gemini" or config.EMBED_SERVICE_URL:
        return None
    if config.EMBEDDING_PROVIDER == "model2vec":
        return static_embed.get_model()
    if _model is None:
        from fastembed import TextEmbedding   # imported lazily: not installed on Gemini-only hosts
        _model = TextEmbedding(model_name=config.EMBEDDING_MODEL)
    return _model


def embed(texts: list[str]):
    if config.EMBEDDING_PROVIDER == "gemini":
        return gemini_embed.embed(texts, "RETRIEVAL_DOCUMENT")
    if config.EMBED_SERVICE_URL:
        return remote_embed.embed(texts)
    if config.EMBEDDING_PROVIDER == "model2vec":
        return static_embed.embed(texts)
    return list(get_model().embed(texts))
