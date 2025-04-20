import { Router } from "express";
import { getWikiData } from "../sources/index.js";
import { processImage } from "../utils/imageProcessing.js";

const router = Router();

router.get("/test/wikipedia", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    console.log(`Testing Wikipedia for query: ${query}`);
    const wikiData = await getWikiData(query);
    console.log(`Wikipedia response: ${JSON.stringify(wikiData)}`);

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
    console.error(`Error testing Wikipedia: ${error.message}`);
    res.status(500).json({ error: "Failed to test Wikipedia source" });
  }
});

export default router;
