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


async def create_lead(public_key: str, lead: dict) -> httpx.Response:
    """Forwards a visitor's details; the caller maps the status code (201/200, 400, 404, 409)."""
    return await _client.post(
        f"{config.BOTS_SERVICE_URL}/internal/bots/{public_key}/leads",
        headers={"X-Internal-Key": config.INTERNAL_API_KEY},
        json=lead,
    )


async def consume_answer(public_key: str) -> tuple[bool, str | None]:
    """Asks the bot service to count one AI answer against the plan. (allowed, reason: "limit" | "inactive")."""
    response = await _client.post(
        f"{config.BOTS_SERVICE_URL}/internal/bots/{public_key}/answers",
        headers={"X-Internal-Key": config.INTERNAL_API_KEY},
    )
    response.raise_for_status()
    body = response.json()
    return bool(body.get("allowed")), body.get("reason")


async def record_turn(public_key: str, turn: dict) -> None:
    """Stores a question and its answer for the owner's conversation history."""
    response = await _client.post(
        f"{config.BOTS_SERVICE_URL}/internal/bots/{public_key}/conversations",
        headers={"X-Internal-Key": config.INTERNAL_API_KEY},
        json=turn,
    )
    if response.status_code >= 500:
        response.raise_for_status()


async def refund_answer(public_key: str) -> None:
    """The AI call failed after the answer was counted; give it back."""
    response = await _client.post(
        f"{config.BOTS_SERVICE_URL}/internal/bots/{public_key}/answers/refund",
        headers={"X-Internal-Key": config.INTERNAL_API_KEY},
    )
    response.raise_for_status()



async def get_channel(channel_id: str) -> dict | None:
    """A connected messaging app with its decrypted secrets (bot service, internal only)."""
    response = await _client.get(f"{config.BOTS_SERVICE_URL}/internal/channels/{channel_id}",
                                 headers={"X-Internal-Key": config.INTERNAL_API_KEY})
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


async def recent_turns(conversation_id: str, take: int = 10) -> list[dict]:
    response = await _client.get(f"{config.BOTS_SERVICE_URL}/internal/conversations/{conversation_id}/turns",
                                 params={"take": take}, headers={"X-Internal-Key": config.INTERNAL_API_KEY})
    response.raise_for_status()
    return response.json()


async def channel_status(channel_id: str, error: str | None) -> None:
    await _client.post(f"{config.BOTS_SERVICE_URL}/internal/channels/{channel_id}/status",
                       headers={"X-Internal-Key": config.INTERNAL_API_KEY}, json={"error": error})
