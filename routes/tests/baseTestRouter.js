import { Router } from "express";
import { processImage } from "../../utils/imageProcessing.js";

const router = Router();

// Common error handling middleware
const errorHandler = (error, req, res, next) => {
  console.error(`Test error: ${error.message}`);
  res.status(500).json({
    status: "error",
    message: error.message,
    source: req.path.split("/").pop()
  });
};

// Common image processing and response handler
const handleImageResponse = async (imageUrl, res, source = "wikipedia") => {
  if (!imageUrl) {
    return res.status(404).json({ error: "No image found" });
  }

  const processedImage = await processImage(imageUrl, source);
  if (!processedImage) {
    return res.status(404).json({ error: "Failed to process image" });
  }

  res.set("Content-Type", "image/png");
  res.send(processedImage);
};

export { router, errorHandler, handleImageResponse };
