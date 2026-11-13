/** Scripted conversations for the website demo (no backend needed). */

export interface DemoQA {
  q: string;
  a: string;
  /** the document the answer "comes from", highlighted while the bot answers */
  doc: string;
}

export interface DemoScenario {
  id: string;
  label: string;
  business: string;
  botName: string;
  welcome: string;
  docs: string[];
  qa: DemoQA[];
  lead: { name: string; phone: string; interest: string };
}

export const SCENARIOS: DemoScenario[] = [
  {
    id: "coaching",
    label: "Coaching institute",
    business: "Sunrise Academy",
    botName: "Sunrise Assistant",
    welcome: "Hi! I can help with courses, fees, batches and admissions at Sunrise Academy.",
    docs: ["Fee_Structure_2026.pdf", "Batch_Timings.docx", "Admission_FAQ.txt"],
    qa: [
      {
        q: "What is the fee for the JEE batch?",
        a: "The JEE two-year programme costs ₹68,000 per year. You can pay in 3 instalments, and toppers of our scholarship test get up to 50% off.",
        doc: "Fee_Structure_2026.pdf",
      },
      {
        q: "When does the next batch start?",
        a: "The next JEE batch starts on 5 January. Morning batch: 7–10 AM, evening batch: 4–7 PM, Monday to Saturday.",
        doc: "Batch_Timings.docx",
      },
      {
        q: "Is there a free demo class?",
        a: "Yes! Every Sunday at 11 AM you can attend a free demo class. Share your number and the counsellor will reserve a seat.",
        doc: "Admission_FAQ.txt",
      },
    ],
    lead: { name: "Rohan Mehta", phone: "+91 98XXX XX214", interest: "JEE 2-year, evening batch" },
  },
  {
    id: "clinic",
    label: "Clinic",
    business: "SmileCare Dental",
    botName: "SmileCare Assistant",
    welcome: "Hello! Ask me about treatments, prices, doctors or timings at SmileCare Dental.",
    docs: ["Treatments_and_Prices.pdf", "Doctors_and_Timings.txt", "Insurance_FAQ.docx"],
    qa: [
      {
        q: "How much does a root canal cost?",
        a: "A root canal at SmileCare costs ₹4,500–₹7,000 depending on the tooth. The first consultation and X-ray are free.",
        doc: "Treatments_and_Prices.pdf",
      },
      {
        q: "Are you open on Sunday?",
        a: "Yes, on Sundays we are open 10 AM to 2 PM with Dr. Kavya Rao. Weekdays: 9 AM to 8 PM.",
        doc: "Doctors_and_Timings.txt",
      },
      {
        q: "Do you accept insurance?",
        a: "We accept cashless claims with Star Health, HDFC Ergo and ICICI Lombard. Please carry your policy card.",
        doc: "Insurance_FAQ.docx",
      },
    ],
    lead: { name: "Priya Nair", phone: "+91 97XXX XX530", interest: "Root canal, Sunday slot" },
  },
  {
    id: "realestate",
    label: "Real estate",
    business: "Greenfield Homes",
    botName: "Greenfield Assistant",
    welcome: "Hi! I can tell you about our projects, prices, amenities and site visits.",
    docs: ["Greenfield_Heights_Brochure.pdf", "Price_List_Nov.pdf", "Site_Visit_FAQ.txt"],
    qa: [
      {
        q: "What is the price of a 2 BHK?",
        a: "2 BHK flats at Greenfield Heights start at ₹62 lakh (842 sq ft carpet). Home loans are pre-approved with SBI and HDFC.",
        doc: "Price_List_Nov.pdf",
      },
      {
        q: "Is it ready to move?",
        a: "Tower A is ready to move with OC received. Towers B and C are due for possession in June 2027.",
        doc: "Greenfield_Heights_Brochure.pdf",
      },
      {
        q: "Can I visit the site this weekend?",
        a: "Of course! Site visits run 10 AM to 6 PM every day, with free pickup from the metro station. Leave your number to book a slot.",
        doc: "Site_Visit_FAQ.txt",
      },
    ],
    lead: { name: "Amit Shah", phone: "+91 99XXX XX871", interest: "2 BHK, site visit Saturday" },
  },
  {
    id: "restaurant",
    label: "Restaurant",
    business: "The Spice Route",
    botName: "Spice Route Assistant",
    welcome: "Namaste! Ask me about our menu, timings, parties or table bookings.",
    docs: ["Menu_2026.pdf", "Party_Packages.docx", "Timings_and_Location.txt"],
    qa: [
      {
        q: "Do you have Jain food?",
        a: "Yes, most of our curries and all our dosas can be made Jain. Just mention it while ordering.",
        doc: "Menu_2026.pdf",
      },
      {
        q: "Can I book for a birthday party of 25?",
        a: "Yes! Our party hall seats up to 40. Packages start at ₹650 per person with a welcome drink and dessert.",
        doc: "Party_Packages.docx",
      },
      {
        q: "Is there parking?",
        a: "Free valet parking is available from 7 PM. We are 200 m from Lakeview Mall, open 12 noon to 11 PM.",
        doc: "Timings_and_Location.txt",
      },
    ],
    lead: { name: "Neha Kapoor", phone: "+91 90XXX XX402", interest: "Birthday party, 25 guests" },
  },
];
