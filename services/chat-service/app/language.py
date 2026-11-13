"""Indian languages: questions in Hindi, Hinglish, Marathi, Tamil... are also searched in English (most business
documents are English), and voice messages are turned into text. Both use a small, fast Gemini call."""
import logging
import re

from google.genai import types

from . import config

log = logging.getLogger("chat")

LANGUAGES = {
    "en": "English", "hi": "Hindi", "mr": "Marathi", "ta": "Tamil", "te": "Telugu", "bn": "Bengali",
    "gu": "Gujarati", "kn": "Kannada", "ml": "Malayalam", "pa": "Punjabi", "ur": "Urdu",
}

# letters of non-Latin scripts (Devanagari, Bengali, Gurmukhi, Gujarati, Tamil, Telugu, Kannada, Malayalam, Arabic...)
_NON_LATIN = re.compile(r"[ऀ-෿؀-ۿ]")
# common Hindi/Marathi words written in English letters: two or more of them = Hinglish
_HINGLISH = set("""hai hain kya kab kaha kahan kitna kitni kitne kaise kyun kyu nahi nahin mujhe hame humein aap aapka
apka kar karna karte milega milegi chahiye bata batao bataiye kripya kaun koi kuch wala wali raha rahi tha thi
hoga hogi abhi agar lekin aur bhi sakta sakte sakti mera meri hamara tumhara yaha yahan waha wahan ko ka ki ke se
mein me pe par hota hoti kitnay ahe aahe kay kasa kiti""".split())

AUDIO_TYPES = {"audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/aac",
               "audio/amr", "audio/opus"}
MAX_AUDIO_BYTES = 3 * 1024 * 1024


def needs_translation(text: str) -> bool:
    if _NON_LATIN.search(text):
        return True
    words = re.findall(r"[a-z]+", text.lower())
    return sum(1 for w in words if w in _HINGLISH) >= 2


def _client():
    from .llm import _client as client   # one Gemini client for the whole service
    return client


async def to_english(text: str) -> str | None:
    """English version of a question for searching; None when it is English already or translation fails."""
    if not needs_translation(text):
        return None
    try:
        res = await _client().aio.models.generate_content(
            model=config.GEMINI_MODEL,
            contents=text,
            config=types.GenerateContentConfig(
                system_instruction="Translate the user's message to English. Hinglish is Hindi written in English "
                                   "letters. Output only the translation, nothing else.",
                temperature=0, max_output_tokens=200),
        )
        out = (res.text or "").strip()
        return out[:1000] or None
    except Exception:
        log.warning("Query translation failed; searching with the original text")
        return None


async def transcribe(audio: bytes, mime_type: str) -> str:
    """Speech to text (any Indian language); the text stays in the language that was spoken."""
    res = await _client().aio.models.generate_content(
        model=config.GEMINI_MODEL,
        contents=[types.Part.from_bytes(data=audio, mime_type=mime_type),
                  "Transcribe this voice message exactly, in the language it is spoken in. "
                  "Output only the transcription. If there is no speech, output nothing."],
        config=types.GenerateContentConfig(temperature=0, max_output_tokens=400),
    )
    return (res.text or "").strip()[:1000]


def language_rule(reply_language: str | None) -> str:
    """System-prompt line about the reply language."""
    name = LANGUAGES.get(reply_language or "")
    if name:
        return f"Always reply in {name}, whatever language the visitor writes in."
    return ("Reply in the same language the visitor used. If they write Hindi or another Indian language in English "
            "letters (for example Hinglish), reply the same way, in English letters.")
