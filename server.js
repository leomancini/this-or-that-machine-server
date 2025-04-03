import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import sharp from "sharp";
import {
  getBrandfetchData,
  getUnsplashData,
  getWikiData
} from "./sources/index.js";

dotenv.config();

const app = express();
const port = 3108;
const openai = new OpenAI();

const supabaseUrl = process.env.SUPABASE_PROJECT_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// API Key middleware
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.query.key;
  if (!apiKey || apiKey !== process.env.APP_API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
};

app.use(express.json());
app.use(apiKeyAuth); // Apply API key auth to all routes

const PairsResponseSchema = z.array(
  z.object({
    type: z.string(),
    source: z.string(),
    option_1_value: z.string(),
    option_2_value: z.string()
  })
);

// Helper function to download and process image
const processImage = async (imageUrl) => {
  try {
    // Ensure URL is absolute
    const absoluteUrl = imageUrl.startsWith("//")
      ? `https:${imageUrl}`
      : imageUrl;

    const response = await fetch(absoluteUrl);
    const buffer = await response.buffer();

    // Process image with sharp
    const processedBuffer = await sharp(buffer)
      .resize(512, 512, {
        fit: "cover",
        position: "center"
      })
      .toBuffer();

    return processedBuffer;
  } catch (error) {
    console.error("Error processing image:", error);
    return null;
  }
};

// Helper function to upload to Supabase storage
const uploadToSupabase = async (buffer, filename) => {
  try {
    const { data, error } = await supabase.storage
      .from("images")
      .upload(filename, buffer, {
        contentType: "image/jpeg",
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

const getUrlForSource = async (source, value) => {
  switch (source) {
    case "brandfetch":
      const brandData = await getBrandfetchData(value);
      return brandData.image;
    case "unsplash":
      const unsplashData = await getUnsplashData(value);
      return unsplashData.image;
    case "wikipedia":
      const wikiData = await getWikiData(value);
      return wikiData.image;
    default:
      return null;
  }
};

app.get("/generate-pairs", apiKeyAuth, async (req, res) => {
  try {
    const { type } = req.query; // Optional type filter

    // First, fetch a limited set of existing pairs to avoid duplicates
    const { data: existingPairs, error: fetchError } = await supabase
      .from("pairs")
      .select("type, source, option_1_value, option_2_value")
      .order("created_at", { ascending: false })
      .limit(100); // Limit to most recent 100 pairs

    if (fetchError) {
      console.error("Error fetching existing pairs:", fetchError);
      throw fetchError;
    }

    // If type is specified, filter pairs by type
    const filteredPairs = type
      ? existingPairs.filter((pair) => pair.type === type)
      : existingPairs;

    // Take a random sample of 10 pairs to show in the prompt
    const samplePairs = filteredPairs
      .sort(() => Math.random() - 0.5) // Shuffle the array
      .slice(0, 10); // Take first 10

    // Format existing pairs for the prompt
    const existingPairsText = samplePairs
      .map(
        (pair) =>
          `- ${pair.type} (${pair.source}): ${pair.option_1_value} vs ${pair.option_2_value}`
      )
      .join("\n");

    const typeFilter = type ? ` of type '${type}'` : "";

    const generatePairsWithOpenAI = async (duplicatePairs = []) => {
      const duplicatePairsText =
        duplicatePairs.length > 0
          ? `\n\nIMPORTANT: The following pairs were already in the database. Please generate completely different pairs:\n${duplicatePairs
              .map(
                (pair) =>
                  `- ${pair.type} (${pair.source}): ${pair.option_1_value} vs ${pair.option_2_value}`
              )
              .join("\n")}`
          : "";

      const response = await openai.responses.create({
        model: "gpt-4o-2024-08-06",
        input: [
          {
            role: "user",
            content: `Generate a set of 10 pairs${typeFilter} of two contrasting options each for a 'this or that' game, where the option values are 1-2 words, with types 'brand' (source: brandfetch), 'animal' (source: unsplash), 'food' (source: unsplash), 'city' (source: wikipedia). For each pair, provide a descriptive label for each option that explains what it represents.

Here are some example pairs from the database to help you understand the format and avoid generating similar pairs:
${existingPairsText}${duplicatePairsText}

Note: The system will automatically check for duplicates before saving any new pairs.`
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "pairs",
            schema: {
              type: "object",
              properties: {
                pairs: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: {
                        type: "string"
                      },
                      source: {
                        type: "string"
                      },
                      option_1_value: {
                        type: "string"
                      },
                      option_2_value: {
                        type: "string"
                      }
                    },
                    required: [
                      "type",
                      "source",
                      "option_1_value",
                      "option_2_value"
                    ],
                    additionalProperties: false
                  }
                }
              },
              required: ["pairs"],
              additionalProperties: false
            }
          }
        }
      });

      return response;
    };

    let allInsertedPairs = [];
    let allDuplicatePairs = [];
    let attempts = 0;
    const MAX_ATTEMPTS = 3;

    while (attempts < MAX_ATTEMPTS) {
      const response = await generatePairsWithOpenAI(allDuplicatePairs);
      const event = JSON.parse(response.output_text);
      const validatedPairs = PairsResponseSchema.parse(event.pairs);

      const insertedPairs = [];
      const duplicatePairs = [];

      // Save each pair to Supabase
      for (const pair of validatedPairs) {
        // Check if pair already exists
        const { data: existingPairs, error: checkError } = await supabase
          .from("pairs")
          .select("id")
          .eq("type", pair.type)
          .eq("source", pair.source)
          .eq("option_1_value", pair.option_1_value)
          .eq("option_2_value", pair.option_2_value);

        if (checkError) {
          console.error("Error checking for duplicates:", checkError);
          throw checkError;
        }

        if (existingPairs && existingPairs.length > 0) {
          duplicatePairs.push(pair);
          continue;
        }

        const { data, error } = await supabase.from("pairs").insert([
          {
            type: pair.type,
            source: pair.source,
            option_1_value: pair.option_1_value,
            option_2_value: pair.option_2_value,
            created_at: new Date().toISOString()
          }
        ]);

        if (error) {
          console.error("Supabase error:", error);
          throw error;
        }

        insertedPairs.push(pair);
      }

      allInsertedPairs = [...allInsertedPairs, ...insertedPairs];
      allDuplicatePairs = [...allDuplicatePairs, ...duplicatePairs];

      // If we found no duplicates, we're done
      if (duplicatePairs.length === 0) {
        break;
      }

      attempts++;
    }

    res.json({
      inserted: allInsertedPairs,
      duplicates: allDuplicatePairs,
      attempts: attempts + 1,
      message: `Successfully inserted ${
        allInsertedPairs.length
      } new pairs after ${attempts + 1} attempt(s), found ${
        allDuplicatePairs.length
      } duplicates`
    });
  } catch (error) {
    console.error("Error:", error);
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: "Invalid response format", details: error.errors });
    } else {
      res.status(500).json({ error: "Failed to generate or save pairs" });
    }
  }
});

app.get("/get-random-pair", apiKeyAuth, async (req, res) => {
  try {
    // Get total count of pairs
    const { count, error: countError } = await supabase
      .from("pairs")
      .select("*", { count: "exact", head: true });

    if (countError) {
      throw countError;
    }

    // Get a random offset
    const randomOffset = Math.floor(Math.random() * count);

    // Fetch one random pair
    const { data, error } = await supabase
      .from("pairs")
      .select(
        "id, type, source, option_1_value, option_2_value, option_1_url, option_2_url, created_at"
      )
      .range(randomOffset, randomOffset)
      .single();

    if (error) {
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to fetch random pair" });
  }
});

app.get("/add-images", apiKeyAuth, async (req, res) => {
  try {
    // Get pairs that don't have URLs
    const { data: pairs, error: fetchError } = await supabase
      .from("pairs")
      .select("*")
      .or("option_1_url.is.null,option_2_url.is.null");

    if (fetchError) {
      throw fetchError;
    }

    const results = [];
    const rowsToDelete = [];

    for (const pair of pairs) {
      const updates = {};
      let foundImage1 = false;
      let foundImage2 = false;

      if (!pair.option_1_url) {
        const url = await getUrlForSource(pair.source, pair.option_1_value);
        if (url) {
          // Process and store image for all sources
          const processedImage = await processImage(url);
          if (processedImage) {
            const filename = `${String(pair.id).padStart(5, "0")}_1.jpg`;
            const storedUrl = await uploadToSupabase(processedImage, filename);
            if (storedUrl) {
              updates.option_1_url = storedUrl;
              foundImage1 = true;
            }
          }
        }
      } else {
        foundImage1 = true;
      }

      if (!pair.option_2_url) {
        const url = await getUrlForSource(pair.source, pair.option_2_value);
        if (url) {
          // Process and store image for all sources
          const processedImage = await processImage(url);
          if (processedImage) {
            const filename = `${String(pair.id).padStart(5, "0")}_2.jpg`;
            const storedUrl = await uploadToSupabase(processedImage, filename);
            if (storedUrl) {
              updates.option_2_url = storedUrl;
              foundImage2 = true;
            }
          }
        }
      } else {
        foundImage2 = true;
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from("pairs")
          .update(updates)
          .eq("id", pair.id);

        if (updateError) {
          results.push({ id: pair.id, error: updateError.message });
        } else {
          results.push({ id: pair.id, updates });
        }
      }

      // If we couldn't find an image for either option, mark for deletion
      if (!foundImage1 || !foundImage2) {
        rowsToDelete.push(pair.id);
      }
    }

    // Delete rows where we couldn't find images for either option
    if (rowsToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from("pairs")
        .delete()
        .in("id", rowsToDelete);

      if (deleteError) {
        console.error("Error deleting rows:", deleteError);
      }
    }

    res.json({
      processed: pairs.length,
      results,
      deleted: rowsToDelete.length
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to update URLs" });
  }
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
