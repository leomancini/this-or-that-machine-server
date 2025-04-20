import { Router } from "express";
import { generateTextImage } from "../sources/index.js";

const router = Router();

router.get("/test/text", async (req, res) => {
  try {
    const { text } = req.query;

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const textData = await generateTextImage(text);

    if (!textData.image) {
      return res.status(404).json({ error: "Failed to generate text image" });
    }

    // Convert base64 data URL to buffer
    const base64Data = textData.image.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Send the processed image
    res.set("Content-Type", "image/png");
    res.send(buffer);
  } catch (error) {
    console.error("Error testing text image generation:", error);
    res.status(500).json({ error: "Failed to generate text image" });
  }
});

export default router;
