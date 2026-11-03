import httpx

from . import config

_client = httpx.AsyncClient(timeout=5.0)


async def resolve_bot(public_key: str) -> dict | None:
    response = await _client.get(
        f"{config.BOTS_SERVICE_URL}/internal/bots/{public_key}",
        headers={"X-Internal-Key": config.INTERNAL_API_KEY},
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()
