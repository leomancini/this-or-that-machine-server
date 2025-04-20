import express from "express";
import { supabase } from "../config/supabase.js";
import VALID_TYPE_SOURCE_COMBINATIONS from "../config/types.json" assert { type: "json" };

const router = express.Router();

// Get metadata endpoint
router.get("/", async (req, res) => {
  try {
    const { data: typesData, error: typesError } = await supabase
      .from("pairs")
      .select("type");

    if (typesError) {
      throw typesError;
    }

    const { data: sourcesData, error: sourcesError } = await supabase
      .from("pairs")
      .select("source");

    if (sourcesError) {
      throw sourcesError;
    }

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

// Get valid types endpoint
router.get("/valid-types", (req, res) => {
  try {
    const validTypes = Object.keys(VALID_TYPE_SOURCE_COMBINATIONS);
    res.json({
      valid_types: validTypes
    });
  } catch (error) {
    console.error("Error fetching valid types:", error);
    res.status(500).json({ error: "Failed to fetch valid types" });
  }
});

// Get valid sources endpoint
router.get("/valid-sources", (req, res) => {
  try {
    const validSources = [
      ...new Set(
        Object.values(VALID_TYPE_SOURCE_COMBINATIONS).map((type) => type.source)
      )
    ];
    res.json({
      valid_sources: validSources
    });
  } catch (error) {
    console.error("Error fetching valid sources:", error);
    res.status(500).json({ error: "Failed to fetch valid sources" });
  }
});

export default router;
