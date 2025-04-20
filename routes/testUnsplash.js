import { Router } from "express";
import { getUnsplashData } from "../sources/index.js";
import { processImage } from "../utils/imageProcessing.js";

const router = Router();

router.get("/test/unsplash", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    console.log(`Testing Unsplash for query: ${query}`);
    const unsplashData = await getUnsplashData(query);
    console.log(`Unsplash response: ${JSON.stringify(unsplashData)}`);

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
    console.error(`Error testing Unsplash: ${error.message}`);
    res.status(500).json({ error: "Failed to test Unsplash source" });
  }
});

export default router;
