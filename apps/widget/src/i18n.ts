/** Widget texts. The bot's answers follow the visitor's language anyway; these are the buttons and labels around them. */
export interface Texts {
  placeholder: string;
  online: string;
  name: string;
  phone: string;
  email: string;
  optional: string;
  submit: string;
  sending: string;
  skip: string;
  consent: string;      // {name} = the business
  needName: string;
  needPhone: string;
  thanks: string;       // {name} = the visitor
  noAnswer: string;
  unavailable: string;
  source: string;
  sources: string;
  greeting: string;
  listening: string;
  micError: string;
  voiceFailed: string;
}

const en: Texts = {
  placeholder: "Type your question…",
  online: "Online · replies instantly",
  name: "Your name",
  phone: "Phone number",
  email: "Email",
  optional: "optional",
  submit: "Request a call back",
  sending: "Sending...",
  skip: "No thanks, keep chatting",
  consent: "By submitting, you agree {name} may contact you about your enquiry.",
  needName: "Please enter your name.",
  needPhone: "Please enter a valid phone number.",
  thanks: "Thank you, {name}! Our team will contact you soon.",
  noAnswer: "Sorry, I don't have an answer for that.",
  unavailable: "This assistant is not available right now.",
  source: "Source",
  sources: "Sources",
  greeting: "👋 Hi! Have a question? Ask me here, I reply instantly.",
  listening: "Listening… tap the mic to stop",
  micError: "The microphone could not be used.",
  voiceFailed: "Sorry, I couldn't understand that. Please type your question.",
};

const hi: Texts = {
  placeholder: "अपना सवाल लिखें…",
  online: "ऑनलाइन · तुरंत जवाब",
  name: "आपका नाम",
  phone: "फ़ोन नंबर",
  email: "ईमेल",
  optional: "वैकल्पिक",
  submit: "कॉल बैक का अनुरोध करें",
  sending: "भेजा जा रहा है...",
  skip: "नहीं, धन्यवाद, चैट जारी रखें",
  consent: "भेजकर आप सहमति देते हैं कि {name} आपकी पूछताछ के बारे में आपसे संपर्क कर सकते हैं।",
  needName: "कृपया अपना नाम लिखें।",
  needPhone: "कृपया सही फ़ोन नंबर लिखें।",
  thanks: "धन्यवाद, {name}! हमारी टीम जल्द ही आपसे संपर्क करेगी।",
  noAnswer: "माफ़ कीजिए, इसका जवाब मेरे पास नहीं है।",
  unavailable: "यह सहायक अभी उपलब्ध नहीं है।",
  source: "स्रोत",
  sources: "स्रोत",
  greeting: "👋 नमस्ते! कोई सवाल है? यहाँ पूछिए, तुरंत जवाब मिलेगा।",
  listening: "सुन रहे हैं… रोकने के लिए माइक दबाएँ",
  micError: "माइक्रोफ़ोन का उपयोग नहीं हो सका।",
  voiceFailed: "माफ़ कीजिए, समझ नहीं आया। कृपया अपना सवाल लिखें।",
};

const mr: Texts = {
  placeholder: "तुमचा प्रश्न लिहा…",
  online: "ऑनलाइन · लगेच उत्तर",
  name: "तुमचे नाव",
  phone: "फोन नंबर",
  email: "ईमेल",
  optional: "ऐच्छिक",
  submit: "कॉल बॅकची विनंती करा",
  sending: "पाठवत आहे...",
  skip: "नको, धन्यवाद, गप्पा सुरू ठेवा",
  consent: "पाठवून तुम्ही सहमती देता की {name} तुमच्या चौकशीबद्दल तुमच्याशी संपर्क साधू शकतात.",
  needName: "कृपया तुमचे नाव लिहा.",
  needPhone: "कृपया योग्य फोन नंबर लिहा.",
  thanks: "धन्यवाद, {name}! आमची टीम लवकरच तुमच्याशी संपर्क साधेल.",
  noAnswer: "माफ करा, याचे उत्तर माझ्याकडे नाही.",
  unavailable: "हा सहाय्यक सध्या उपलब्ध नाही.",
  source: "स्रोत",
  sources: "स्रोत",
  greeting: "👋 नमस्कार! काही प्रश्न आहे? इथे विचारा, लगेच उत्तर मिळेल.",
  listening: "ऐकत आहे… थांबवण्यासाठी माइक दाबा",
  micError: "मायक्रोफोन वापरता आला नाही.",
  voiceFailed: "माफ करा, समजले नाही. कृपया तुमचा प्रश्न लिहा.",
};

const ta: Texts = {
  placeholder: "உங்கள் கேள்வியை எழுதுங்கள்…",
  online: "ஆன்லைன் · உடனடி பதில்",
  name: "உங்கள் பெயர்",
  phone: "தொலைபேசி எண்",
  email: "மின்னஞ்சல்",
  optional: "விருப்பத்தேர்வு",
  submit: "திரும்ப அழைக்கக் கோருங்கள்",
  sending: "அனுப்பப்படுகிறது...",
  skip: "வேண்டாம், அரட்டையைத் தொடருங்கள்",
  consent: "சமர்ப்பிப்பதன் மூலம், உங்கள் விசாரணை குறித்து {name} உங்களைத் தொடர்பு கொள்ள நீங்கள் ஒப்புக்கொள்கிறீர்கள்.",
  needName: "உங்கள் பெயரை உள்ளிடவும்.",
  needPhone: "சரியான தொலைபேசி எண்ணை உள்ளிடவும்.",
  thanks: "நன்றி, {name}! எங்கள் குழு விரைவில் உங்களைத் தொடர்பு கொள்ளும்.",
  noAnswer: "மன்னிக்கவும், இதற்கான பதில் என்னிடம் இல்லை.",
  unavailable: "இந்த உதவியாளர் இப்போது கிடைக்கவில்லை.",
  source: "ஆதாரம்",
  sources: "ஆதாரங்கள்",
  greeting: "👋 வணக்கம்! ஏதாவது கேள்வி உள்ளதா? இங்கே கேளுங்கள், உடனே பதில் கிடைக்கும்.",
  listening: "கேட்கிறது… நிறுத்த மைக்கைத் தட்டவும்",
  micError: "மைக்ரோஃபோனைப் பயன்படுத்த முடியவில்லை.",
  voiceFailed: "மன்னிக்கவும், புரியவில்லை. உங்கள் கேள்வியை எழுதுங்கள்.",
};

const te: Texts = {
  placeholder: "మీ ప్రశ్నను టైప్ చేయండి…",
  online: "ఆన్‌లైన్ · వెంటనే సమాధానం",
  name: "మీ పేరు",
  phone: "ఫోన్ నంబర్",
  email: "ఇమెయిల్",
  optional: "ఐచ్ఛికం",
  submit: "కాల్ బ్యాక్ కోరండి",
  sending: "పంపుతోంది...",
  skip: "వద్దు, చాట్ కొనసాగించండి",
  consent: "సమర్పించడం ద్వారా, మీ విచారణ గురించి {name} మిమ్మల్ని సంప్రదించడానికి మీరు అంగీకరిస్తున్నారు.",
  needName: "దయచేసి మీ పేరు నమోదు చేయండి.",
  needPhone: "దయచేసి సరైన ఫోన్ నంబర్ నమోదు చేయండి.",
  thanks: "ధన్యవాదాలు, {name}! మా బృందం త్వరలో మిమ్మల్ని సంప్రదిస్తుంది.",
  noAnswer: "క్షమించండి, దీనికి సమాధానం నా దగ్గర లేదు.",
  unavailable: "ఈ సహాయకుడు ప్రస్తుతం అందుబాటులో లేదు.",
  source: "మూలం",
  sources: "మూలాలు",
  greeting: "👋 నమస్కారం! ఏదైనా ప్రశ్న ఉందా? ఇక్కడ అడగండి, వెంటనే సమాధానం లభిస్తుంది.",
  listening: "వింటోంది… ఆపడానికి మైక్‌ను నొక్కండి",
  micError: "మైక్రోఫోన్‌ను ఉపయోగించలేకపోయాం.",
  voiceFailed: "క్షమించండి, అర్థం కాలేదు. దయచేసి మీ ప్రశ్నను టైప్ చేయండి.",
};

export const TEXTS: Record<string, Texts> = { en, hi, mr, ta, te };

/** The owner's reply language when we have texts for it; "auto" follows the visitor's browser. */
export function pickLanguage(botLanguage: string | undefined, browser: string | undefined): string {
  if (botLanguage && botLanguage !== "auto") return TEXTS[botLanguage] ? botLanguage : "en";
  const base = (browser || "en").slice(0, 2).toLowerCase();
  return TEXTS[base] ? base : "en";
}

export function fill(template: string, name: string): string {
  return template.replace("{name}", name);
}

/** BCP-47 voice for reading an answer aloud, from its script. */
// written as escaped strings so the bundle stays pure ASCII (see vite.config.ts)
const TAMIL = new RegExp("[\u0B80-\u0BFF]");
const TELUGU = new RegExp("[\u0C00-\u0C7F]");
const DEVANAGARI = new RegExp("[\u0900-\u097F]");

export function speechLang(text: string, uiLang: string): string {
  if (TAMIL.test(text)) return "ta-IN";
  if (TELUGU.test(text)) return "te-IN";
  if (DEVANAGARI.test(text)) return uiLang === "mr" ? "mr-IN" : "hi-IN";
  return "en-IN";
}
