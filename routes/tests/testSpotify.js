import { Router } from "express";
import { getSpotifyToken } from "../../utils/spotify.js";
import fetch from "node-fetch";
import { errorHandler, handleImageResponse } from "./baseTestRouter.js";

const router = Router();

router.get("/test/spotify", async (req, res, next) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const token = getSpotifyToken();
    if (!token) {
      return res.status(401).json({ error: "No Spotify token available" });
    }

    // Test the token by making a request to Spotify's API
    const response = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(
        query
      )}&type=album&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Spotify API returned ${response.status}: ${response.statusText}`
      );
    }

    const data = await response.json();
    const album = data.albums?.items[0];

    if (!album || !album.images || album.images.length === 0) {
      return res.status(404).json({ error: "No album image found" });
    }

    // Get the highest resolution image (first one in the array)
    const imageUrl = album.images[0].url;
    await handleImageResponse(imageUrl, res);
  } catch (error) {
    next(error);
  }
});

router.use(errorHandler);
export default router;
