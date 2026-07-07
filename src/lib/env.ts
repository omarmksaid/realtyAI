import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const env = {
  APP_URL: req("APP_URL"),
  DATABASE_URL: req("DATABASE_URL"),               // Supabase pooler connection string
  SUPABASE_URL: req("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: req("SUPABASE_SERVICE_ROLE_KEY"),
  SUPABASE_JWT_SECRET: req("SUPABASE_JWT_SECRET"),
  ANTHROPIC_API_KEY: req("ANTHROPIC_API_KEY"),
  VOYAGE_API_KEY: process.env.VOYAGE_API_KEY ?? "",

  TWILIO_ACCOUNT_SID: req("TWILIO_ACCOUNT_SID"),
  TWILIO_AUTH_TOKEN: req("TWILIO_AUTH_TOKEN"),
  TWILIO_WHATSAPP_NUMBER: req("TWILIO_WHATSAPP_NUMBER"),
  TWILIO_FIRST_TOUCH_TEMPLATE_SID: req("TWILIO_FIRST_TOUCH_TEMPLATE_SID"),
  TWILIO_REENGAGE_TEMPLATE_SID: process.env.TWILIO_REENGAGE_TEMPLATE_SID ?? "",

  RESEND_API_KEY: req("RESEND_API_KEY"),
  EMAIL_FROM: req("EMAIL_FROM"),

  VAPI_API_KEY: process.env.VAPI_API_KEY ?? "",
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY ?? "",
  DEFAULT_VOICE_ID: process.env.DEFAULT_VOICE_ID ?? "",
  VAPI_PHONE_NUMBER_ID: process.env.VAPI_PHONE_NUMBER_ID ?? "",
  VAPI_WEBHOOK_SECRET: process.env.VAPI_WEBHOOK_SECRET ?? "",

  META_APP_SECRET: req("META_APP_SECRET"),
  META_VERIFY_TOKEN: req("META_VERIFY_TOKEN"),

  BROKERAGE_NAME: process.env.BROKERAGE_NAME ?? "Your Brokerage",
  BROKERAGE_ADDRESS: process.env.BROKERAGE_ADDRESS ?? "Toronto, ON",
};
