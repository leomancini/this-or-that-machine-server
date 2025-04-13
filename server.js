import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import sharp from "sharp";
import cors from "cors";
import {
  getUnsplashData,
  getWikiData,
  getLogoDevData
} from "./sources/index.js";

dotenv.config();

const IMAGE_SIZE = parseInt(process.env.IMAGE_SIZE);

const app = express();
const port = 3108;
const openai = new OpenAI();

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

      return res.json({
        message: "Vote updated successfully",
        votes: {
          ...existingVotes,
          ...updateData
        }
      });
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

      return res.json({
        message: "Vote created successfully",
        votes: data
      });
    }
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

app.delete("/delete-pair", apiKeyAuth, async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: "Pair ID is required" });
    }

    // First, delete any associated votes
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

    res.json({ message: "Pair and associated votes deleted successfully" });
  } catch (error) {
    console.error("Error deleting pair:", error);
    res.status(500).json({ error: "Failed to delete pair" });
  }
});

app.get("/get-all-pairs", apiKeyAuth, async (req, res) => {
  try {
    // Optional query parameters for filtering and pagination
    const { type, source, limit = 100, offset = 0 } = req.query;

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

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
