import "dotenv/config";
import pkg from "pg";
const { Pool } = pkg;

export const connectDB = new Pool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "postgres",
  port: process.env.DB_PORT || 5432,
  password: process.env.DB_PASSWORD || "798214",
  database: process.env.DB_NAME || "CRM",
});

connectDB.connect()
  .then(async (client) => {
    console.log("✅ PostgreSQL Connected");
    try {
      await client.query(`
        ALTER TABLE IF EXISTS public.leads ALTER COLUMN company DROP NOT NULL;
        ALTER TABLE IF EXISTS public.leads ALTER COLUMN company SET DEFAULT '';
        ALTER TABLE IF EXISTS public.leads ALTER COLUMN phone DROP NOT NULL;
        ALTER TABLE IF EXISTS public.leads ALTER COLUMN phone SET DEFAULT '';
        ALTER TABLE IF EXISTS public.leads ALTER COLUMN email DROP NOT NULL;
        ALTER TABLE IF EXISTS public.leads ALTER COLUMN email SET DEFAULT '';
        ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS next_activity_at TIMESTAMPTZ;
        ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS scheduled_activity_type VARCHAR(100);
        ALTER TABLE IF EXISTS public.leads ADD COLUMN IF NOT EXISTS scheduled_activity_note TEXT;
      `);
      console.log("✅ Leads table constraints and reminder columns verified");
    } catch (e) {
      console.error("⚠️ Migration query warning:", e.message);
    } finally {
      client.release();
    }
  })
  .catch((err) => console.error("❌ Connection Error:", err));

export default connectDB;
