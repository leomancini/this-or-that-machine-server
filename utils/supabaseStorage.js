import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_PROJECT_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Helper function to upload to Supabase storage
export const uploadToSupabase = async (buffer, filename) => {
  try {
    // Determine content type based on filename
    const contentType = filename.endsWith(".png") ? "image/png" : "image/jpeg";

    const { data, error } = await supabase.storage
      .from("images")
      .upload(filename, buffer, {
        contentType,
        upsert: true
      });

    if (error) throw error;

    // Get public URL
    const {
      data: { publicUrl }
    } = supabase.storage.from("images").getPublicUrl(filename);

    return publicUrl;
  } catch (error) {
    console.error("Error uploading to Supabase:", error);
    return null;
  }
};
