"""Indian languages: questions in Hindi, Hinglish, Marathi, Tamil... are also searched in English (most business
documents are English), and voice messages are turned into text. Both use a small, fast Gemini call."""
import asyncio
import logging
import re

from google.genai import types

from . import config
from .cache import TTLCache

log = logging.getLogger("chat")

TRANSLATE_TIMEOUT = 5.0  # seconds
_translations = TTLCache(maxsize=4000, ttl=24 * 3600)   # the same Hinglish question is translated once

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
    key = " ".join(text.lower().split())
    cached = _translations.get(key)
    if cached is not None:
        return cached or None
    try:
        # only a search helper: when Gemini is slow, answer with the original text instead of making the visitor wait
        res = await asyncio.wait_for(_client().aio.models.generate_content(
            model=config.GEMINI_MODEL,
            contents=text,
            config=types.GenerateContentConfig(
                system_instruction="Translate the user's message to English. Hinglish is Hindi written in English "
                                   "letters. Output only the translation, nothing else.",
                temperature=0, max_output_tokens=200),
        ), timeout=TRANSLATE_TIMEOUT)
        out = (res.text or "").strip()[:1000]
        _translations.set(key, out)
        return out or None
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


# ---------- the reply when the knowledge does not cover a question ----------
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")

# by language, then by what the visitor can do next:
#   "callback": the website chat can show the call-back form; "contact": no form; "noted": a messaging app,
#   where the question is kept for the owner (listed under "Unanswered")
NO_ANSWER = {
    "en": {
        "callback": "I don't have that information yet. Leave your number and our team will call you back with the details.",
        "contact": "I don't have that information yet. Please contact us directly and our team will help you.",
        "noted": "I don't have that information yet. I've noted your question for our team.",
    },
    "hinglish": {
        "callback": "Iski jaankari abhi mere paas nahi hai. Apna number chhodiye, hamari team aapko call karke bata degi.",
        "contact": "Iski jaankari abhi mere paas nahi hai. Kripya humse seedha sampark karein, hamari team aapki madad karegi.",
        "noted": "Iski jaankari abhi mere paas nahi hai. Maine aapka sawaal hamari team tak pahuncha diya hai.",
    },
    "hi": {
        "callback": "इसकी जानकारी अभी मेरे पास नहीं है। अपना नंबर छोड़िए, हमारी टीम आपको कॉल करके बता देगी।",
        "contact": "इसकी जानकारी अभी मेरे पास नहीं है। कृपया हमसे सीधे संपर्क करें, हमारी टीम आपकी मदद करेगी।",
        "noted": "इसकी जानकारी अभी मेरे पास नहीं है। मैंने आपका सवाल हमारी टीम तक पहुँचा दिया है।",
    },
}


def reply_language(question: str, setting: str | None) -> str:
    """"en", "hinglish" or "hi" for the built-in replies: the owner's fixed language, else the visitor's own."""
    if setting == "hi":
        return "hi"
    if setting and setting != "auto":
        return "en"   # other fixed languages: English (the AI itself answers in the chosen language)
    if _DEVANAGARI.search(question):
        return "hi"
    return "hinglish" if needs_translation(question) else "en"


def no_answer_text(bot: dict, question: str, next_step: str) -> str:
    """The owner's own message when set, otherwise the built-in one in the visitor's language."""
    style = bot.get("style") or {}
    custom = " ".join(str(style.get("noAnswerMessage") or "").split())[:300]
    if custom:
        return custom
    return NO_ANSWER[reply_language(question, style.get("replyLanguage"))][next_step]
