import fetch from "node-fetch";
import { getSpotifyToken } from "../utils/spotify.js";

export const getSpotifyData = async (query, type, market = "US") => {
  try {
    const token = getSpotifyToken();
    if (!token) {
      throw new Error("No Spotify access token available");
    }

    const searchResponse = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(
        query
      )}&type=${type}&market=${market}&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!searchResponse.ok) {
      console.error(
        "Spotify API error:",
        searchResponse.status,
        searchResponse.statusText
      );
      return {
        image: null,
        id: null,
        artist: null
      };
    }

    const searchData = await searchResponse.json();

    // Get the first result's images
    const firstResult = searchData.albums?.items[0];

    if (
      !firstResult ||
      !firstResult.images ||
      firstResult.images.length === 0
    ) {
      return {
        image: null,
        id: null,
        artist: null
      };
    }

    // Return the highest resolution image (first one in the array is always highest res)
    return {
      image: firstResult.images[0].url,
      id: firstResult.id,
      artist: firstResult.artists?.[0]?.name || null
    };
  } catch (error) {
    console.error("Error getting Spotify data:", error);
    return null;
  }
};
