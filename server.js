import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import sharp from "sharp";
import cors from "cors";
import { WebSocketServer } from "ws";
import {
  getUnsplashData,
  getWikiData,
  getLogoDevData
} from "./sources/index.js";

dotenv.config();

const IMAGE_SIZE = parseInt(process.env.IMAGE_SIZE);

const app = express();
const apiPort = 3108;
const socketPort = 3109;
const openai = new OpenAI();

// Store recent pairs to prevent duplicates
const RECENT_PAIRS_SIZE = 5; // Number of recent pairs to remember
let recentPairs = [];

// Configure CORS
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE"]
  })
);

const supabaseUrl = process.env.SUPABASE_PROJECT_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Start the HTTP server
app.listen(apiPort, () => {
  console.log(`HTTP Server is running at http://localhost:${apiPort}`);
});

// Create WebSocket server
const wss = new WebSocketServer({ port: socketPort });

// Store connected clients
const clients = new Set();

wss.on("connection", (ws) => {
  console.log("New WebSocket client connected");
  clients.add(ws);

  ws.on("close", () => {
    console.log("Client disconnected");
    clients.delete(ws);
  });
});

// Helper function to broadcast to all clients
const broadcast = (data) => {
  const message = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

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

    // Check if the content is SVG or XML
    const contentType = response.headers.get("content-type");
    if (
      contentType &&
      (contentType.includes("svg") || contentType.includes("xml"))
    ) {
      console.log("Skipping SVG/XML image:", imageUrl);
      return null;
    }

    // Process image with sharp
    const processedBuffer = await sharp(buffer)
      .resize(IMAGE_SIZE, IMAGE_SIZE, {
        fit: "cover",
        position: "center",
        background: { r: 0, g: 0, b: 0, alpha: 1 },
        kernel: "lanczos3" // Use high-quality scaling algorithm
      })
      .png({ quality: 100 }) // Convert to PNG with maximum quality
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

const getUrlForSource = async (source, value) => {
  switch (source) {
    case "logodev":
      const logoDevData = await getLogoDevData(value);
      return logoDevData.image;
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

// Helper function to generate pairs using OpenAI
const generatePairsWithOpenAI = async (
  type,
  existingPairs,
  duplicatePairs = []
) => {
  const typeFilter = type ? ` of type '${type}'` : "";
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
        content: `Generate a set of 10 pairs${typeFilter} of two contrasting options each for a 'this or that' game, where the option values are 1-2 words, with types 'brand' (source: logodev), 'animal' (source: unsplash), 'food' (source: unsplash),  For each pair, provide a descriptive label for each option that explains what it represents.

Here are some example pairs from the database to help you understand the format and avoid generating similar pairs:
${existingPairs}${duplicatePairsText}

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

// Helper function to save pairs to database
const savePairsToDatabase = async (pairs) => {
  const insertedPairs = [];
  const duplicatePairs = [];

  for (const pair of pairs) {
    // Check if pair already exists
    const { data: existingPairs, error: checkError } = await supabase
      .from("pairs")
      .select("id")
      .eq("type", pair.type)
      .eq("source", pair.source)
      .eq("option_1_value", pair.option_1_value)
      .eq("option_2_value", pair.option_2_value);

    if (checkError) {
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
      throw error;
    }

    insertedPairs.push(pair);
  }

  return { insertedPairs, duplicatePairs };
};

// Helper function to add images to pairs
const addImagesToPairs = async (pairs, shouldDeleteMissing = true) => {
  const results = [];
  const rowsToDelete = [];

  for (const pair of pairs) {
    try {
      const updates = {};
      let foundImage1 = false;
      let foundImage2 = false;

      if (!pair.option_1_url) {
        const url = await getUrlForSource(pair.source, pair.option_1_value);
        if (url) {
          const processedImage = await processImage(url);
          if (processedImage) {
            const extension = url.toLowerCase().endsWith(".png")
              ? ".png"
              : ".jpg";
            const filename = `${String(pair.id).padStart(
              5,
              "0"
            )}_1${extension}`;
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
          const processedImage = await processImage(url);
          if (processedImage) {
            const extension = url.toLowerCase().endsWith(".png")
              ? ".png"
              : ".jpg";
            const filename = `${String(pair.id).padStart(
              5,
              "0"
            )}_2${extension}`;
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

      if (shouldDeleteMissing && (!foundImage1 || !foundImage2)) {
        rowsToDelete.push(pair.id);
      }
    } catch (error) {
      console.error(`Error processing pair ${pair.id}:`, error);
      results.push({ id: pair.id, error: error.message });
      if (shouldDeleteMissing) {
        rowsToDelete.push(pair.id);
      }
    }
  }

  if (shouldDeleteMissing && rowsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("pairs")
      .delete()
      .in("id", rowsToDelete);

    if (deleteError) {
      console.error("Error deleting rows:", deleteError);
    }
  }

  return { results, deleted: rowsToDelete.length };
};

// Helper function to find and delete duplicate pairs
const findAndDeleteDuplicates = async () => {
  try {
    // Get all pairs
    const { data: allPairs, error: fetchError } = await supabase
      .from("pairs")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      throw fetchError;
    }

    const duplicates = [];
    const pairsToDelete = new Set();

    // Create a map to track unique pairs
    const uniquePairs = new Map();

    // Iterate through all pairs
    for (const pair of allPairs) {
      // Create a normalized key that's the same regardless of option order
      const key = [pair.option_1_value, pair.option_2_value].sort().join("|");

      if (uniquePairs.has(key)) {
        // This is a duplicate, add to deletion list
        pairsToDelete.add(pair.id);
        duplicates.push({
          id: pair.id,
          type: pair.type,
          source: pair.source,
          option_1_value: pair.option_1_value,
          option_2_value: pair.option_2_value,
          created_at: pair.created_at
        });
      } else {
        // First time seeing this pair, add to unique pairs
        uniquePairs.set(key, pair.id);
      }
    }

    // Convert Set to Array for deletion
    const pairsToDeleteArray = Array.from(pairsToDelete);

    if (pairsToDeleteArray.length > 0) {
      // Delete the duplicate pairs
      const { error: deleteError } = await supabase
        .from("pairs")
        .delete()
        .in("id", pairsToDeleteArray);

      if (deleteError) {
        throw deleteError;
      }
    }

    return {
      deleted: pairsToDeleteArray.length,
      duplicates
    };
  } catch (error) {
    console.error("Error finding and deleting duplicates:", error);
    throw error;
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
            content: `Generate a set of 10 pairs${typeFilter} of two contrasting options each for a 'this or that' game, where the option values are 1-2 words, with types 'brand' (source: logodev), 'animal' (source: unsplash), 'food' (source: unsplash),  For each pair, provide a descriptive label for each option that explains what it represents.

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

      const { insertedPairs, duplicatePairs } = await savePairsToDatabase(
        validatedPairs
      );

      allInsertedPairs = [...allInsertedPairs, ...insertedPairs];
      allDuplicatePairs = [...allDuplicatePairs, ...duplicatePairs];

      if (duplicatePairs.length === 0) {
        break;
      }

      attempts++;
    }

    // Add images to the newly inserted pairs
    const { results, deleted } = await addImagesToPairs(allInsertedPairs);

    // Find and delete any duplicates in the database
    const { deleted: deletedDuplicates, duplicates: foundDuplicates } =
      await findAndDeleteDuplicates();

    res.json({
      inserted: allInsertedPairs,
      duplicates: allDuplicatePairs,
      attempts: attempts + 1,
      image_results: results,
      deleted: deleted,
      deleted_duplicates: deletedDuplicates,
      found_duplicates: foundDuplicates,
      message: `Successfully inserted ${
        allInsertedPairs.length
      } new pairs after ${attempts + 1} attempt(s), found ${
        allDuplicatePairs.length
      } duplicates, processed images for ${
        results.length
      } pairs, and deleted ${deletedDuplicates} duplicate pairs`
    });
  } catch (error) {
    console.error("Error:", error);
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: "Invalid response format", details: error.errors });
    } else {
      res
        .status(500)
        .json({ error: "Failed to generate pairs and add images" });
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

    let randomOffset;
    let data;
    let attempts = 0;
    const MAX_ATTEMPTS = 10; // Maximum number of attempts to find a non-recent pair

    do {
      // Get a random offset
      randomOffset = Math.floor(Math.random() * count);

      // Fetch one random pair
      const { data: pairData, error } = await supabase
        .from("pairs")
        .select(
          "id, type, source, option_1_value, option_2_value, option_1_url, option_2_url, created_at"
        )
        .range(randomOffset, randomOffset)
        .single();

      if (error) {
        throw error;
      }

      data = pairData;
      attempts++;

      // If we've tried too many times, just return the current pair
      if (attempts >= MAX_ATTEMPTS) {
        break;
      }
    } while (recentPairs.includes(data.id)); // Keep trying until we find a non-recent pair

    // Add the new pair to recent pairs
    recentPairs.push(data.id);
    // Keep the array at the specified size
    if (recentPairs.length > RECENT_PAIRS_SIZE) {
      recentPairs.shift(); // Remove the oldest pair
    }

    // Format the response
    const formattedResponse = {
      id: data.id,
      type: data.type,
      source: data.source,
      created_at: data.created_at,
      options: [
        {
          value: data.option_1_value,
          url: data.option_1_url
        },
        {
          value: data.option_2_value,
          url: data.option_2_url
        }
      ]
    };

    res.json(formattedResponse);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to fetch random pair" });
  }
});

app.get("/test/logodev", apiKeyAuth, async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    console.log("Testing LogoDev for query:", query);
    const logoDevData = await getLogoDevData(query);
    console.log("LogoDev response:", logoDevData);

    if (!logoDevData.image) {
      return res.status(404).json({ error: "No logo found for this query" });
    }

    // Process the image using the existing function
    const processedImage = await processImage(logoDevData.image);
    if (!processedImage) {
      return res.status(404).json({ error: "Failed to process image" });
    }

    // Send the processed image
    res.set("Content-Type", "image/png");
    res.send(processedImage);
  } catch (error) {
    console.error("Error testing LogoDev:", error);
    res.status(500).json({ error: "Failed to test LogoDev source" });
  }
});

app.get("/test/unsplash", apiKeyAuth, async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    console.log("Testing Unsplash for query:", query);
    const unsplashData = await getUnsplashData(query);
    console.log("Unsplash response:", unsplashData);

    if (!unsplashData.image) {
      return res.status(404).json({ error: "No image found for this query" });
    }

    // Process the image using the existing function
    const processedImage = await processImage(unsplashData.image);
    if (!processedImage) {
      return res.status(404).json({ error: "Failed to process image" });
    }

    // Send the processed image
    res.set("Content-Type", "image/png");
    res.send(processedImage);
  } catch (error) {
    console.error("Error testing Unsplash:", error);
    res.status(500).json({ error: "Failed to test Unsplash source" });
  }
});

app.get("/test/wikipedia", apiKeyAuth, async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    console.log("Testing Wikipedia for query:", query);
    const wikiData = await getWikiData(query);
    console.log("Wikipedia response:", wikiData);

    if (!wikiData.image) {
      return res.status(404).json({ error: "No image found for this query" });
    }

    // Process the image using the existing function
    const processedImage = await processImage(wikiData.image);
    if (!processedImage) {
      return res.status(404).json({ error: "Failed to process image" });
    }

    // Send the processed image
    res.set("Content-Type", "image/png");
    res.send(processedImage);
  } catch (error) {
    console.error("Error testing Wikipedia:", error);
    res.status(500).json({ error: "Failed to test Wikipedia source" });
  }
});

app.get("/add-images", apiKeyAuth, async (req, res) => {
  try {
    const { delete_missing = "true" } = req.query;
    const shouldDeleteMissing = delete_missing.toLowerCase() === "true";

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
      try {
        const updates = {};
        let foundImage1 = false;
        let foundImage2 = false;

        if (!pair.option_1_url) {
          const url = await getUrlForSource(pair.source, pair.option_1_value);
          if (url) {
            // Process and store image for all sources
            const processedImage = await processImage(url);
            if (processedImage) {
              // Determine file extension based on source URL
              const extension = url.toLowerCase().endsWith(".png")
                ? ".png"
                : ".jpg";
              const filename = `${String(pair.id).padStart(
                5,
                "0"
              )}_1${extension}`;
              const storedUrl = await uploadToSupabase(
                processedImage,
                filename
              );
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
              // Determine file extension based on source URL
              const extension = url.toLowerCase().endsWith(".png")
                ? ".png"
                : ".jpg";
              const filename = `${String(pair.id).padStart(
                5,
                "0"
              )}_2${extension}`;
              const storedUrl = await uploadToSupabase(
                processedImage,
                filename
              );
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
        if (shouldDeleteMissing && (!foundImage1 || !foundImage2)) {
          rowsToDelete.push(pair.id);
        }
      } catch (error) {
        console.error(`Error processing pair ${pair.id}:`, error);
        results.push({ id: pair.id, error: error.message });
        // If we're deleting missing images and we hit an error, mark for deletion
        if (shouldDeleteMissing) {
          rowsToDelete.push(pair.id);
        }
      }
    }

    // Delete rows where we couldn't find images for either option
    if (shouldDeleteMissing && rowsToDelete.length > 0) {
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
      deleted: rowsToDelete.length,
      delete_missing: shouldDeleteMissing
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to update URLs" });
  }
});

app.get("/get-all-pair-ids", apiKeyAuth, async (req, res) => {
  try {
    // Optional query parameters for filtering
    const { type, source, limit = 100, offset = 0 } = req.query;

    // Build the query
    let query = supabase.from("pairs").select("id");

    // Apply filters if provided
    if (type) {
      query = query.eq("type", type);
    }

    if (source) {
      query = query.eq("source", source);
    }

    // Apply pagination
    query = query.range(
      parseInt(offset),
      parseInt(offset) + parseInt(limit) - 1
    );

    // Execute the query
    const { data, error } = await query;

    if (error) {
      throw error;
    }

    // Return just an array of IDs
    const ids = data.map((pair) => pair.id);
    res.json(ids);
  } catch (error) {
    console.error("Error fetching pair IDs:", error);
    res.status(500).json({ error: "Failed to fetch pair IDs" });
  }
});

app.get("/vote", apiKeyAuth, async (req, res) => {
  try {
    const { id, option } = req.query;

    if (!id || !option) {
      return res.status(400).json({ error: "id and option are required" });
    }

    if (option !== "1" && option !== "2") {
      return res.status(400).json({ error: "option must be 1 or 2" });
    }

    // First, get the pair details
    const { data: pair, error: pairError } = await supabase
      .from("pairs")
      .select("id, option_1_value, option_2_value")
      .eq("id", id)
      .single();

    if (pairError || !pair) {
      return res.status(404).json({ error: "Pair not found" });
    }

    // Check if votes exist for this pair
    const { data: existingVotes, error: voteError } = await supabase
      .from("votes")
      .select("*")
      .eq("option_1_value", pair.option_1_value)
      .eq("option_2_value", pair.option_2_value)
      .single();

    if (voteError && voteError.code !== "PGRST116") {
      // PGRST116 is "not found" error
      throw voteError;
    }

    let voteData;
    if (existingVotes) {
      // Update existing votes
      const updateData = {
        option_1_count:
          option === "1"
            ? existingVotes.option_1_count + 1
            : existingVotes.option_1_count,
        option_2_count:
          option === "2"
            ? existingVotes.option_2_count + 1
            : existingVotes.option_2_count,
        pair_id: pair.id
      };

      const { error: updateError } = await supabase
        .from("votes")
        .update(updateData)
        .eq("id", existingVotes.id);

      if (updateError) throw updateError;

      voteData = {
        ...existingVotes,
        ...updateData
      };
    } else {
      // Create new vote record
      const newVote = {
        option_1_value: pair.option_1_value,
        option_2_value: pair.option_2_value,
        option_1_count: option === "1" ? 1 : 0,
        option_2_count: option === "2" ? 1 : 0,
        pair_id: pair.id
      };

      const { data, error: insertError } = await supabase
        .from("votes")
        .insert([newVote])
        .select()
        .single();

      if (insertError) throw insertError;
      voteData = data;
    }

    // Broadcast the vote event to all connected clients
    broadcast({
      type: "vote",
      data: {
        pair_id: pair.id,
        option_1: {
          value: pair.option_1_value,
          count: voteData.option_1_count
        },
        option_2: {
          value: pair.option_2_value,
          count: voteData.option_2_count
        }
      }
    });

    return res.json({
      message: "Vote processed successfully",
      votes: voteData
    });
  } catch (error) {
    console.error("Error processing vote:", error);
    res.status(500).json({ error: "Failed to process vote" });
  }
});

app.get("/validate-api-key", (req, res) => {
  const apiKey = req.query.key;
  if (!apiKey || apiKey !== process.env.APP_API_KEY) {
    return res.status(401).json({ valid: false, message: "Invalid API key" });
  }
  return res.json({ valid: true, message: "API key is valid" });
});

app.get("/get-metadata", apiKeyAuth, async (req, res) => {
  try {
    // Get all unique types
    const { data: typesData, error: typesError } = await supabase
      .from("pairs")
      .select("type");

    if (typesError) {
      throw typesError;
    }

    // Get all unique sources
    const { data: sourcesData, error: sourcesError } = await supabase
      .from("pairs")
      .select("source");

    if (sourcesError) {
      throw sourcesError;
    }

    // Get unique values using Set
    const types = [...new Set(typesData.map((item) => item.type))];
    const sources = [...new Set(sourcesData.map((item) => item.source))];

    res.json({
      types,
      sources
    });
  } catch (error) {
    console.error("Error fetching metadata:", error);
    res.status(500).json({ error: "Failed to fetch metadata" });
  }
});

app.delete("/delete-pair", apiKeyAuth, async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: "Pair ID is required" });
    }

    // First, get the pair to find the image URLs
    const { data: pair, error: pairFetchError } = await supabase
      .from("pairs")
      .select("option_1_url, option_2_url")
      .eq("id", id)
      .single();

    if (pairFetchError) {
      console.error("Error fetching pair:", pairFetchError);
      throw pairFetchError;
    }

    // Delete the images from Supabase storage
    if (pair.option_1_url) {
      const filename1 = pair.option_1_url.split("/").pop();
      const { error: deleteImage1Error } = await supabase.storage
        .from("images")
        .remove([filename1]);

      if (deleteImage1Error) {
        console.error("Error deleting image 1:", deleteImage1Error);
      }
    }

    if (pair.option_2_url) {
      const filename2 = pair.option_2_url.split("/").pop();
      const { error: deleteImage2Error } = await supabase.storage
        .from("images")
        .remove([filename2]);

      if (deleteImage2Error) {
        console.error("Error deleting image 2:", deleteImage2Error);
      }
    }

    // Delete any associated votes
    const { error: votesError } = await supabase
      .from("votes")
      .delete()
      .eq("pair_id", id);

    if (votesError) {
      console.error("Error deleting votes:", votesError);
      throw votesError;
    }

    // Then delete the pair
    const { error: pairError } = await supabase
      .from("pairs")
      .delete()
      .eq("id", id);

    if (pairError) {
      console.error("Error deleting pair:", pairError);
      throw pairError;
    }

    res.json({
      message: "Pair, associated votes, and images deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting pair:", error);
    res.status(500).json({ error: "Failed to delete pair" });
  }
});

app.get("/get-all-pairs", apiKeyAuth, async (req, res) => {
  try {
    // Optional query parameters for filtering and pagination
    const { type, source, limit = 20, offset = 0 } = req.query;

    // Build the query for pairs
    let query = supabase
      .from("pairs")
      .select("*")
      .order("created_at", { ascending: false });

    // Apply filters if provided
    if (type) {
      query = query.eq("type", type);
    }

    if (source) {
      query = query.eq("source", source);
    }

    // Apply pagination
    query = query.range(
      parseInt(offset),
      parseInt(offset) + parseInt(limit) - 1
    );

    // Execute the query
    const { data: pairs, error: pairsError } = await query;

    if (pairsError) {
      throw pairsError;
    }

    // Get all votes for these pairs
    const pairIds = pairs.map((pair) => pair.id);
    const { data: votes, error: votesError } = await supabase
      .from("votes")
      .select("*")
      .in("pair_id", pairIds);

    if (votesError) {
      throw votesError;
    }

    // Create a map of votes by pair_id for quick lookup
    const votesMap = new Map();
    votes.forEach((vote) => {
      votesMap.set(vote.pair_id, vote);
    });

    // Format the response to include vote counts
    const formattedData = pairs.map((pair) => {
      const voteData = votesMap.get(pair.id) || {
        option_1_count: 0,
        option_2_count: 0
      };

      return {
        id: pair.id,
        type: pair.type,
        source: pair.source,
        created_at: pair.created_at,
        options: [
          {
            value: pair.option_1_value,
            url: pair.option_1_url,
            votes: voteData.option_1_count
          },
          {
            value: pair.option_2_value,
            url: pair.option_2_url,
            votes: voteData.option_2_count
          }
        ]
      };
    });

    res.json(formattedData);
  } catch (error) {
    console.error("Error fetching pairs:", error);
    res.status(500).json({ error: "Failed to fetch pairs" });
  }
});

app.get("/get-all-votes", apiKeyAuth, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    // Get all votes
    const { data: votes, error: votesError } = await supabase
      .from("votes")
      .select("*");

    if (votesError) {
      throw votesError;
    }

    // Get all pair IDs from votes
    const pairIds = votes.map((vote) => vote.pair_id);

    // Get the corresponding pairs
    const { data: pairs, error: pairsError } = await supabase
      .from("pairs")
      .select("id, option_1_url, option_2_url")
      .in("id", pairIds);

    if (pairsError) {
      throw pairsError;
    }

    // Create a map of pairs by ID for quick lookup
    const pairsMap = new Map();
    pairs.forEach((pair) => {
      pairsMap.set(pair.id, pair);
    });

    // Format the response with vote information and image URLs, filtering out votes without pairs
    const allFormattedVotes = votes
      .filter((vote) => pairsMap.has(vote.pair_id))
      .map((vote) => {
        const pair = pairsMap.get(vote.pair_id);
        const totalVotes = vote.option_1_count + vote.option_2_count;
        const majority = Math.abs(vote.option_1_count - vote.option_2_count);
        const winningPercentage = Math.max(
          vote.option_1_count / totalVotes,
          vote.option_2_count / totalVotes
        );
        return {
          option_1: {
            value: vote.option_1_value,
            count: vote.option_1_count,
            url: pair.option_1_url
          },
          option_2: {
            value: vote.option_2_value,
            count: vote.option_2_count,
            url: pair.option_2_url
          },
          total_votes: totalVotes,
          majority: majority,
          winning_percentage: winningPercentage
        };
      })
      .sort((a, b) => {
        // First sort by winning percentage (descending)
        if (b.winning_percentage !== a.winning_percentage) {
          return b.winning_percentage - a.winning_percentage;
        }
        // If percentages are equal, sort by total votes (descending)
        return b.total_votes - a.total_votes;
      })
      .map(({ option_1, option_2 }) => ({ option_1, option_2 }));

    // Apply pagination
    const paginatedVotes = allFormattedVotes.slice(
      parseInt(offset),
      parseInt(offset) + parseInt(limit)
    );

    res.json({
      votes: paginatedVotes,
      total: allFormattedVotes.length,
      has_more: parseInt(offset) + parseInt(limit) < allFormattedVotes.length
    });
  } catch (error) {
    console.error("Error fetching votes:", error);
    res.status(500).json({ error: "Failed to fetch votes" });
  }
});

app.get("/get-random-pair-votes", apiKeyAuth, async (req, res) => {
  try {
    // First get all pairs that have votes
    const { data: votes, error: votesError } = await supabase
      .from("votes")
      .select("pair_id, option_1_count, option_2_count")
      .or("option_1_count.gt.0,option_2_count.gt.0");

    if (votesError) {
      throw votesError;
    }

    if (!votes || votes.length === 0) {
      return res.status(404).json({ error: "No pairs with votes found" });
    }

    // Get a random pair with votes
    const randomVote = votes[Math.floor(Math.random() * votes.length)];

    // Fetch the pair details
    const { data: pairData, error: pairError } = await supabase
      .from("pairs")
      .select(
        "id, type, source, option_1_value, option_2_value, option_1_url, option_2_url, created_at"
      )
      .eq("id", randomVote.pair_id)
      .single();

    if (pairError) {
      throw pairError;
    }

    // Format the response
    const formattedResponse = {
      id: pairData.id,
      options: [
        {
          value: pairData.option_1_value,
          url: pairData.option_1_url,
          votes: randomVote.option_1_count
        },
        {
          value: pairData.option_2_value,
          url: pairData.option_2_url,
          votes: randomVote.option_2_count
        }
      ]
    };

    res.json(formattedResponse);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to fetch random pair votes" });
  }
});
