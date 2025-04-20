export const getUnsplashData = async (query) => {
  const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

  if (!UNSPLASH_ACCESS_KEY) {
    console.error("Missing Unsplash credentials");
    return {
      image: null,
      photoId: null
    };
  }

  try {
    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
        query
      )}&per_page=1`,
      {
        headers: {
          Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`
        }
      }
    );

    if (!response.ok) {
      console.error(
        "Unsplash API error:",
        response.status,
        response.statusText
      );
      return {
        image: null,
        photoId: null
      };
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return {
        image: null,
        photoId: null
      };
    }

    const image = data.results[0]?.urls?.regular || null;
    const photoId = data.results[0]?.id || null;

    if (!image) {
      return {
        image: null,
        photoId: null
      };
    }

    return {
      image,
      photoId
    };
  } catch (error) {
    console.error("Error in getUnsplashData:", error);
    return {
      image: null,
      photoId: null
    };
  }
};
