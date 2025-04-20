import express from "express";
import { z } from "zod";
import { supabase } from "../config/supabase.js";
import { generatePairsWithOpenAI } from "../utils/openai.js";
import {
  transformPairsForDatabase,
  savePairsToDatabase
} from "../utils/pairs.js";
import { processImage } from "../utils/imageProcessing.js";
import { getUrlForSource } from "../utils/imageSources.js";

const router = express.Router();
const RECENT_PAIRS_SIZE = 10;
const recentPairs = [];

const uploadToSupabase = async (imageBuffer, filename) => {
  try {
    const { data, error } = await supabase.storage
      .from("images")
      .upload(filename, imageBuffer, {
        contentType: "image/png",
        upsert: true
      });

    if (error) {
      console.error("Error uploading to Supabase:", error);
      return null;
    }

    const {
      data: { publicUrl }
    } = supabase.storage.from("images").getPublicUrl(filename);

    return publicUrl;
  } catch (error) {
    console.error("Error in uploadToSupabase:", error);
    return null;
  }
};

const PairsResponseSchema = z.object({
  pairs: z.array(
    z.object({
      type: z.string(),
      source: z.string(),
      option_1: z.string(),
      option_2: z.string()
    })
  )
});

// Generate pairs endpoint
router.get("/generate-pairs", async (req, res) => {
  try {
    const { count = 10 } = req.query;
    const targetCount = parseInt(count);
    let remainingCount = targetCount;
    let allInsertedPairs = [];
    let allDuplicatePairs = [];
    let attempts = 0;
    const MAX_ATTEMPTS = 3;

    // First, fetch a limited set of existing pairs to avoid duplicates
    const { data: existingPairs, error: fetchError } = await supabase
      .from("pairs")
      .select("type, source, option_1_value, option_2_value")
      .order("created_at", { ascending: false })
      .limit(100);

    if (fetchError) {
      console.error(`Error fetching existing pairs: ${fetchError.message}`);
      return res.status(500).json({
        error: "Failed to fetch existing pairs",
        details: fetchError.message
      });
    }

    const samplePairs = existingPairs || [];
    const randomPairs = samplePairs
      .sort(() => Math.random() - 0.5)
      .slice(0, 10);

    const existingPairsText = randomPairs
      .map(
        (pair) =>
          `- ${pair.type} (${pair.source}): ${pair.option_1_value} vs ${pair.option_2_value}`
      )
      .join("\n");

    while (remainingCount > 0 && attempts < MAX_ATTEMPTS) {
      const response = await generatePairsWithOpenAI(
        null,
        existingPairsText,
        allDuplicatePairs,
        { count: remainingCount }
      );
      const event = JSON.parse(response.output_text);
      const validatedPairs = PairsResponseSchema.parse(event);
      const transformedPairs = transformPairsForDatabase(validatedPairs.pairs);

      const { insertedPairs, duplicatePairs } = await savePairsToDatabase(
        transformedPairs
      );

      allInsertedPairs = [...allInsertedPairs, ...insertedPairs];
      allDuplicatePairs = [...allDuplicatePairs, ...duplicatePairs];
      remainingCount = targetCount - allInsertedPairs.length;
      attempts++;

      if (remainingCount === 0) {
        break;
      }
    }

    res.json({
      inserted: allInsertedPairs,
      duplicates: allDuplicatePairs,
      attempts,
      message: `Successfully inserted ${allInsertedPairs.length} new pairs after ${attempts} attempt(s), found ${allDuplicatePairs.length} duplicates`
    });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: "Invalid response format", details: error.errors });
    } else {
      res.status(500).json({ error: "Failed to generate pairs" });
    }
  }
});

// Generate pairs by type endpoint
router.get("/generate-pairs-by-type", async (req, res) => {
  try {
    const { type, count = 10 } = req.query;
    const targetCount = parseInt(count);
    let remainingCount = targetCount;
    let allInsertedPairs = [];
    let allDuplicatePairs = [];
    let attempts = 0;
    const MAX_ATTEMPTS = 5;

    if (!type) {
      return res.status(400).json({ error: "type is required" });
    }

    const { data: existingPairs, error: fetchError } = await supabase
      .from("pairs")
      .select("type, source, option_1_value, option_2_value")
      .eq("type", type)
      .order("created_at", { ascending: false })
      .limit(100);

    if (fetchError) {
      console.error(`Error fetching existing pairs: ${fetchError.message}`);
      throw fetchError;
    }

    const samplePairs = existingPairs || [];
    const randomPairs = samplePairs
      .sort(() => Math.random() - 0.5)
      .slice(0, 10);

    const existingPairsText = randomPairs
      .map(
        (pair) =>
          `- ${pair.type} (${pair.source}): ${pair.option_1_value} vs ${pair.option_2_value}`
      )
      .join("\n");

    while (remainingCount > 0 && attempts < MAX_ATTEMPTS) {
      const response = await generatePairsWithOpenAI(
        type,
        existingPairsText,
        allDuplicatePairs,
        { count: remainingCount }
      );
      const event = JSON.parse(response.output_text);
      const validatedPairs = PairsResponseSchema.parse(event);
      const transformedPairs = transformPairsForDatabase(validatedPairs.pairs);

      const { insertedPairs, duplicatePairs } = await savePairsToDatabase(
        transformedPairs
      );

      allInsertedPairs = [...allInsertedPairs, ...insertedPairs];
      allDuplicatePairs = [...allDuplicatePairs, ...duplicatePairs];
      remainingCount = targetCount - allInsertedPairs.length;
      attempts++;

      if (remainingCount === 0) {
        break;
      }
    }

    res.json({
      inserted: allInsertedPairs,
      duplicates: allDuplicatePairs,
      attempts,
      message: `Successfully inserted ${allInsertedPairs.length} new pairs after ${attempts} attempt(s), found ${allDuplicatePairs.length} duplicates`
    });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: "Invalid response format", details: error.errors });
    } else {
      res.status(500).json({ error: "Failed to generate pairs" });
    }
  }
});

// Get random pair endpoint
router.get("/get-random-pair", async (req, res) => {
  try {
    const { count, error: countError } = await supabase
      .from("pairs")
      .select("*", { count: "exact", head: true });

    if (countError) {
      throw countError;
    }

    let randomOffset;
    let data;
    let attempts = 0;
    const MAX_ATTEMPTS = 10;

    do {
      randomOffset = Math.floor(Math.random() * count);
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

      if (attempts >= MAX_ATTEMPTS) {
        break;
      }
    } while (recentPairs.includes(data.id));

    recentPairs.push(data.id);
    if (recentPairs.length > RECENT_PAIRS_SIZE) {
      recentPairs.shift();
    }

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

// Get all pairs endpoint
router.get("/get-all-pairs", async (req, res) => {
  try {
    const { type, source, limit = 20, offset = 0 } = req.query;

    let query = supabase
      .from("pairs")
      .select("*")
      .order("created_at", { ascending: false });

    if (type) {
      query = query.eq("type", type);
    }

    if (source) {
      query = query.eq("source", source);
    }

    query = query.range(
      parseInt(offset),
      parseInt(offset) + parseInt(limit) - 1
    );

    const { data: pairs, error: pairsError } = await query;

    if (pairsError) {
      throw pairsError;
    }

    const pairIds = pairs.map((pair) => pair.id);
    const { data: votes, error: votesError } = await supabase
      .from("votes")
      .select("*");

    if (votesError) {
      throw votesError;
    }

    const votesMap = new Map();
    votes.forEach((vote) => {
      votesMap.set(vote.pair_id, vote);
    });

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

// Delete pair endpoint
router.delete("/delete-pair", async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: "Pair ID is required" });
    }

    const { data: pair, error: pairFetchError } = await supabase
      .from("pairs")
      .select("option_1_url, option_2_url")
      .eq("id", id)
      .single();

    if (pairFetchError) {
      console.error(`Error fetching pair: ${pairFetchError.message}`);
      throw pairFetchError;
    }

    if (pair.option_1_url) {
      const filename1 = pair.option_1_url.split("/").pop();
      const { error: deleteImage1Error } = await supabase.storage
        .from("images")
        .remove([filename1]);

      if (deleteImage1Error) {
        console.error(`Error deleting image 1: ${deleteImage1Error.message}`);
      }
    }

    if (pair.option_2_url) {
      const filename2 = pair.option_2_url.split("/").pop();
      const { error: deleteImage2Error } = await supabase.storage
        .from("images")
        .remove([filename2]);

      if (deleteImage2Error) {
        console.error(`Error deleting image 2: ${deleteImage2Error.message}`);
      }
    }

    const { error: votesError } = await supabase
      .from("votes")
      .delete()
      .eq("pair_id", id);

    if (votesError) {
      console.error(`Error deleting votes: ${votesError.message}`);
      throw votesError;
    }

    const { error: pairError } = await supabase
      .from("pairs")
      .delete()
      .eq("id", id);

    if (pairError) {
      console.error(`Error deleting pair: ${pairError.message}`);
      throw pairError;
    }

    res.json({
      message: "Pair, associated votes, and images deleted successfully"
    });
  } catch (error) {
    console.error(`Error deleting pair: ${error.message}`);
    res.status(500).json({ error: "Failed to delete pair" });
  }
});

// Get all pair IDs endpoint
router.get("/get-all-pair-ids", async (req, res) => {
  try {
    const { type, source } = req.query;

    let query = supabase
      .from("pairs")
      .select("id")
      .order("created_at", { ascending: false });

    if (type) {
      query = query.eq("type", type);
    }

    if (source) {
      query = query.eq("source", source);
    }

    const { data: pairs, error: pairsError } = await query;

    if (pairsError) {
      throw pairsError;
    }

    const pairIds = pairs.map((pair) => pair.id);
    res.json(pairIds);
  } catch (error) {
    console.error("Error fetching pair IDs:", error);
    res.status(500).json({ error: "Failed to fetch pair IDs" });
  }
});

// Add images to pairs endpoint
router.get("/add-images", async (req, res) => {
  try {
    // Get all pairs without images
    const { data: pairsWithoutImages, error: fetchError } = await supabase
      .from("pairs")
      .select("*")
      .or("option_1_url.is.null,option_2_url.is.null");

    if (fetchError) {
      throw fetchError;
    }

    if (!pairsWithoutImages || pairsWithoutImages.length === 0) {
      return res.json({ message: "No pairs without images found" });
    }

    const results = [];
    const rowsToDelete = [];

    for (const pair of pairsWithoutImages) {
      try {
        const updates = {};
        let foundImage1 = false;
        let foundImage2 = false;

        if (!pair.option_1_url) {
          const url = await getUrlForSource(
            pair.source,
            pair.option_1_value,
            pair.type
          );
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
          const url = await getUrlForSource(
            pair.source,
            pair.option_2_value,
            pair.type
          );
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

        if (!foundImage1 || !foundImage2) {
          rowsToDelete.push(pair.id);
        }
      } catch (error) {
        console.error(`Error processing pair ${pair.id}: ${error.message}`);
        results.push({ id: pair.id, error: error.message });
        rowsToDelete.push(pair.id);
      }
    }

    if (rowsToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from("pairs")
        .delete()
        .in("id", rowsToDelete);

      if (deleteError) {
        console.error(`Error deleting rows: ${deleteError.message}`);
      }
    }

    res.json({
      message: `Processed ${pairsWithoutImages.length} pairs`,
      updated: results.filter((r) => !r.error).length,
      deleted: rowsToDelete.length,
      details: {
        results,
        deleted: rowsToDelete
      }
    });
  } catch (error) {
    console.error("Error adding images:", error);
    res.status(500).json({ error: "Failed to add images" });
  }
});

export default router;
