import fetch from "node-fetch";
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } from "../config/env.js";

// Function to get Spotify access token using Client Credentials flow
export const getSpotifyAccessToken = async () => {
  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
        ).toString("base64")}`
      },
      body: new URLSearchParams({
        grant_type: "client_credentials"
      })
    });

    const data = await response.json();
    if (data.error) {
      console.error("Spotify API Error:", data);
      throw new Error(data.error_description || data.error);
    }

    return data.access_token;
  } catch (error) {
    console.error("Error getting Spotify access token:", error);
    return null;
  }
};

// Initialize Spotify access token
let _spotifyAccessToken = null;

// Getter and setter for the token
export const getSpotifyToken = () => _spotifyAccessToken;
export const setSpotifyToken = (token) => {
  _spotifyAccessToken = token;
};

// Initial token fetch
getSpotifyAccessToken().then((token) => {
  setSpotifyToken(token);
});
