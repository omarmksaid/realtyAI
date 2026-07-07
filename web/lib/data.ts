// Data layer. When NEXT_PUBLIC_SUPABASE_URL is unset the app runs in demo mode
// with the data below, so you can evaluate the UX with `npm run dev` and zero setup.
// Each fetcher has its Supabase query noted — swap them in once wired.

export type Score = "hot" | "warm" | "cold";

export interface LeadRow {
  id: string; name: string; project: string; source: "meta" | "google";
  status: string; channel: string; language: string; langLabel: string;
  score: Score; scoreReason: string; receivedAt: string;
}

export interface Turn {
  id: string; role: "lead" | "ai" | "agent" | "system";
  text: string; gloss?: string; at: string;
}

export const demoDigest = {
  date: "Friday, July 3",
  body: [
    `Nine leads came in overnight across three projects; six engaged in conversation. Two are worth calling before 10am.`,
    `**Reza Karimi** (The Riv, Vaughan) asked twice about the deposit structure and whether the 5% is extended for the July allocation — he's comparing against a Pickering project and said he wants to "lock something this month." Recommend a call first thing. **Priya Sharma** (Union East, Scarborough) asked for 2-bed floor plans facing away from the tracks and about assignment rights; she replied within 40 seconds at 11:20pm, which usually means active shopping.`,
    `The remaining engaged leads asked general pricing questions and received the overview packages. One lead (Marcus T., Google) asked to be contacted only by email — preference saved. No opt-outs, no complaints.`,
  ],
};

export const demoLeads: LeadRow[] = [
  { id: "l1", name: "Reza Karimi", project: "The Riv — Vaughan", source: "meta", status: "engaged", channel: "whatsapp", language: "fa", langLabel: "فارسی · Farsi", score: "hot", scoreReason: "Asked about deposit structure twice, buying this month", receivedAt: "11:47 PM" },
  { id: "l2", name: "Priya Sharma", project: "Union East — Scarborough", source: "meta", status: "engaged", channel: "whatsapp", language: "en", langLabel: "English", score: "hot", scoreReason: "Requested specific floor plans + assignment rights", receivedAt: "11:19 PM" },
  { id: "l3", name: "Wei Chen", project: "Harbourline — Mississauga", source: "google", status: "engaged", channel: "whatsapp", language: "zh", langLabel: "中文 · Mandarin", score: "warm", scoreReason: "Asked about occupancy date and parking cost", receivedAt: "10:02 PM" },
  { id: "l4", name: "Marcus Thompson", project: "The Riv — Vaughan", source: "google", status: "contacted", channel: "email", language: "en", langLabel: "English", score: "warm", scoreReason: "Prefers email; opened overview twice", receivedAt: "9:38 PM" },
  { id: "l5", name: "Amandeep Gill", project: "Union East — Scarborough", source: "meta", status: "contacted", channel: "whatsapp", language: "pa", langLabel: "ਪੰਜਾਬੀ · Punjabi", score: "cold", scoreReason: "No reply yet to first touch", receivedAt: "2:11 AM" },
];

export const demoConversation: { lead: LeadRow; status: "ai" | "human"; turns: Turn[] } = {
  lead: demoLeads[0],
  status: "ai",
  turns: [
    { id: "t0", role: "system", text: "Lead from Meta ad · The Riv 5% Deposit campaign · 11:47 PM — after-hours rule 'Late night' matched: WhatsApp + email", at: "11:47 PM" },
    { id: "t1", role: "ai", text: "Hi Reza, thanks for your interest in The Riv in Vaughan! I'm the assistant for Northgate Realty. Want the floor plans and pricing, or have a question I can answer now?", at: "11:47 PM" },
    { id: "t2", role: "lead", text: "سلام، ساختار پرداخت ودیعه چطوره؟ ۵٪ هنوز برقراره؟", gloss: "Hi, how does the deposit structure work? Is the 5% still available?", at: "11:49 PM" },
    { id: "t3", role: "ai", text: "سلام رضا! بله — برای تخصیص ژوئیه، ۵٪ در ۳۰ روز و ۵٪ در ۱۸۰ روز است. می‌خواهید جدول کامل پرداخت را برایتان ایمیل کنم؟", gloss: "Hi Reza! Yes — for the July allocation it's 5% in 30 days and 5% in 180 days. Want me to email you the full payment schedule?", at: "11:49 PM" },
    { id: "t4", role: "lead", text: "بله لطفا. من دارم با یک پروژه در پیکرینگ مقایسه می‌کنم و می‌خوام همین ماه یکی رو قطعی کنم", gloss: "Yes please. I'm comparing with a project in Pickering and want to lock one in this month", at: "11:52 PM" },
    { id: "t5", role: "ai", text: "فرستادم! چون این ماه تصمیم می‌گیرید، تیم ما فردا صبح با شما تماس می‌گیرد تا واحدهای موجود را بررسی کنید. چه ساعتی مناسب است؟", gloss: "Sent! Since you're deciding this month, our team will call you tomorrow morning to review available units. What time works?", at: "11:53 PM" },
  ],
};

export const demoProjects = [
  {
    id: "p1", name: "The Riv", city: "Vaughan", leads30d: 84, driveLinked: true,
    docs: [
      { id: "d1", name: "Floor plans — Tower A (PDF, 42 pages)", source: "drive", status: "ready" },
      { id: "d2", name: "July price list", source: "drive", status: "ready" },
      { id: "d3", name: "Deposit structure memo (pasted text)", source: "text", status: "ready" },
      { id: "d4", name: "Amenity renderings (6 images)", source: "upload", status: "processing" },
    ],
  },
  {
    id: "p2", name: "Union East", city: "Scarborough", leads30d: 51, driveLinked: false,
    docs: [{ id: "d5", name: "Project overview (pasted text)", source: "text", status: "ready" }],
  },
  { id: "p3", name: "Harbourline", city: "Mississauga", leads30d: 37, driveLinked: false, docs: [] },
];

export const demoRules = [
  { id: "r1", label: "Weekday evening", window: "Weekdays · 5:00 PM – 10:00 PM", channels: ["WhatsApp", "AI call after 10 min", "Email"], active: true },
  { id: "r2", label: "Late night", window: "Every day · 10:00 PM – 9:00 AM", channels: ["WhatsApp", "Email"], active: true },
  { id: "r3", label: "Weekend day", window: "Weekends · 9:00 AM – 10:00 PM", channels: ["WhatsApp", "AI call after 10 min", "Email"], active: true },
];

export const demoStats = { newLeads: 9, engaged: 6, engagementRate: "67%", handoffs: 2 };

// ---- Supabase swap-in (when NEXT_PUBLIC_SUPABASE_URL is set) ----
// leads:        supabase.from('leads').select('*, projects(name)').order('created_at',{ascending:false})
// digest:       supabase.from('daily_summaries').select('*').eq('for_date', today).single()
// conversation: supabase.from('messages').select('*').eq('conversation_id', id).order('created_at')
// takeover:     POST `${API_URL}/agent/conversations/${id}/takeover`  then POST /agent/messages
export const isDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL;
