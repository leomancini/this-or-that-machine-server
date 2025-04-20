import { Router } from "express";
import { getSpotifyAccessToken, setSpotifyToken } from "../utils/spotify.js";

const router = Router();

router.get("/spotify/refresh-token", async (req, res) => {
  try {
    const token = await getSpotifyAccessToken();
    if (!token) {
      return res
        .status(500)
        .json({ error: "Failed to get Spotify access token" });
    }
    setSpotifyToken(token);
    res.json({ message: "Spotify token refreshed successfully" });
  } catch (error) {
    console.error("Error refreshing Spotify token:", error);
    res.status(500).json({ error: "Failed to refresh Spotify token" });
  }
});

export default router;
