import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables
dotenv.config();

// Define environment schema
const envSchema = z.object({
  APP_API_KEY: z.string(),
  OPENAI_API_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
  SUPABASE_PROJECT_URL: z.string(),
  UNSPLASH_ACCESS_KEY: z.string(),
  LOGO_DEV_PUBLISHABLE_KEY: z.string(),
  LOGO_DEV_SECRET_KEY: z.string(),
  SPOTIFY_CLIENT_ID: z.string(),
  SPOTIFY_CLIENT_SECRET: z.string(),
  IMAGE_SIZE: z.string().transform(Number)
});

// Validate environment variables
let parsedEnv;
try {
  parsedEnv = envSchema.parse(process.env);
} catch (error) {
  console.error("❌ Invalid environment variables:", error.errors);
  process.exit(1);
}

// Export environment variables
export const {
  APP_API_KEY,
  OPENAI_API_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_PROJECT_URL,
  UNSPLASH_ACCESS_KEY,
  LOGO_DEV_PUBLISHABLE_KEY,
  LOGO_DEV_SECRET_KEY,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  IMAGE_SIZE
} = parsedEnv;
