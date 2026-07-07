import PgBoss from "pg-boss";
import { env } from "../lib/env";

// pg-boss uses your Supabase Postgres directly — no Redis, one less service on Railway.
export const boss = new PgBoss(env.DATABASE_URL);
