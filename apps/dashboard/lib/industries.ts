import type { IconName } from "@/components/Icon";

/** Business types offered during onboarding: each gives the new assistant a fitting welcome and one-tap questions. */
export interface Industry {
  id: string;
  icon: IconName;
  label: string;
  welcome: string;
  questions: string[];
  leadLabel: string;
  /** sample knowledge in /public/samples for "Try with a sample" */
  sample: string;
}

export const INDUSTRIES: Industry[] = [
  { id: "coaching", icon: "cap", label: "Coaching / school", welcome: "Namaste! Ask me about courses, fees, batch timings or admissions.",
    questions: ["What are the fees?", "When does the next batch start?", "Is there a free demo class?", "Where are you located?"], leadLabel: "Course", sample: "sunrise-academy.txt" },
  { id: "clinic", icon: "pulse", label: "Clinic / hospital", welcome: "Hello! I can help with timings, doctors, treatments and appointments.",
    questions: ["What are your timings?", "How do I book an appointment?", "What is the consultation fee?", "Do you accept insurance?"], leadLabel: "Treatment", sample: "smilecare-dental.txt" },
  { id: "realestate", icon: "home", label: "Real estate", welcome: "Hi! Ask me about projects, prices, sizes and site visits.",
    questions: ["What is the price range?", "Which sizes are available?", "Can I book a site visit?", "Is it RERA approved?"], leadLabel: "Project / budget", sample: "greenvalley-homes.txt" },
  { id: "restaurant", icon: "utensils", label: "Restaurant / café", welcome: "Hello! Ask me about our menu, timings, delivery or table booking.",
    questions: ["What are your timings?", "Do you deliver?", "Can I book a table?", "Do you have veg options?"], leadLabel: "Booking for", sample: "spice-route-kitchen.txt" },
  { id: "salon", icon: "scissors", label: "Salon / spa / gym", welcome: "Hi! Ask me about services, prices, timings or booking a slot.",
    questions: ["What are your prices?", "Can I book a slot?", "What are your timings?", "Do you have packages?"], leadLabel: "Service", sample: "sunrise-academy.txt" },
  { id: "shop", icon: "bag", label: "Shop / online store", welcome: "Hello! Ask me about products, prices, delivery or returns.",
    questions: ["Do you deliver to my area?", "What is the return policy?", "Is cash on delivery available?", "How long does delivery take?"], leadLabel: "Product", sample: "sunrise-academy.txt" },
  { id: "other", icon: "grid", label: "Something else", welcome: "Hi! How can I help you today?",
    questions: ["What services do you offer?", "What are your prices?", "What are your timings?", "How can I contact you?"], leadLabel: "Interested in", sample: "sunrise-academy.txt" },
];

export const LANGUAGES = [
  { id: "auto", label: "Same as the customer" },
  { id: "en", label: "English" },
  { id: "hi", label: "Hindi" },
  { id: "mr", label: "Marathi" },
  { id: "ta", label: "Tamil" },
  { id: "te", label: "Telugu" },
];
