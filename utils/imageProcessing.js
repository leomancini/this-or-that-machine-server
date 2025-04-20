import sharp from "sharp";
import fetch from "node-fetch";
import { AbortController } from "node-abort-controller";
import { IMAGE_SIZE } from "../config/env.js";

export const processImage = async (imageUrl) => {
  try {
    // Handle data URLs from text image generation
    if (imageUrl.startsWith("data:image/")) {
      // Extract the base64 data
      const base64Data = imageUrl.split(",")[1];
      const buffer = Buffer.from(base64Data, "base64");

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
    }

    // Handle regular URLs
    // Ensure URL is absolute
    const absoluteUrl = imageUrl.startsWith("//")
      ? `https:${imageUrl}`
      : imageUrl;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(absoluteUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

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
