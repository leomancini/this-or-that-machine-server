import { Router } from "express";
import { getLogoDevData } from "../sources/index.js";
import { processImage } from "../utils/imageProcessing.js";

const router = Router();

router.get("/test/logodev", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    console.log(`Testing LogoDev for query: ${query}`);
    const logoDevData = await getLogoDevData(query);
    console.log(`LogoDev response: ${JSON.stringify(logoDevData)}`);

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
    console.error(`Error testing LogoDev: ${error.message}`);
    res.status(500).json({ error: "Failed to test LogoDev source" });
  }
});

export default router;
