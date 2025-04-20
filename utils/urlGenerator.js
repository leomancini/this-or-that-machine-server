import {
  getUnsplashData,
  getWikiData,
  getLogoDevData,
  getSpotifyData,
  generateTextImage
} from "../sources/index.js";

// Helper function to get URL for a source
export const getUrlForSource = async (source, value, type) => {
  console.log(
    `Getting image for ${value.toUpperCase()} on ${source.toUpperCase()}`
  );
  switch (source) {
    case "logodev":
      const logoDevData = await getLogoDevData(value);
      return logoDevData.image;
    case "unsplash":
      const unsplashData = await getUnsplashData(value);
      return unsplashData.image;
    case "wikipedia":
      const wikiData = await getWikiData(`${value} (${type})`);
      return wikiData.image;
    case "spotify":
      const spotifyData = await getSpotifyData(value, type);
      return spotifyData.image;
    case "text":
      console.log(`Generating text image for: ${value}`);
      const textData = await generateTextImage(value);
      return textData.image;
    default:
      return null;
  }
};
