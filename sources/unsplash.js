export const getUnsplashData = async (query) => {
  const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
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
  const data = await response.json();
  return {
    image: data.results[0]?.urls?.regular || null,
    photoId: data.results[0]?.id || null
  };
};
