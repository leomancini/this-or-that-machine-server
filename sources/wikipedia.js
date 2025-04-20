const findMostSimilarImage = (query, images) => {
  if (!images || !images.length) return null;

  // Remove "File:" prefix and normalize the query
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Score each image title based on similarity to the query
  const scoredImages = images.map((image) => {
    const title = image.title
      .replace("File:", "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    // Skip SVG and XML files
    if (title.endsWith(".svg") || title.endsWith(".xml")) {
      return { title: image.title, score: -1 };
    }

    // Improved similarity scoring:
    // 1. Count exact matches of query words in title
    const queryWords = normalizedQuery.split(
      /(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/
    );
    const wordMatches = queryWords.filter((word) =>
      title.includes(word)
    ).length;

    const charMatches = normalizedQuery
      .split("")
      .filter((char) => title.includes(char)).length;

    // Combine scores with higher weight for word matches
    let score = wordMatches * 2 + charMatches;

    // Bonus points for movie-related terms
    if (
      title.includes("poster") ||
      title.includes("cover") ||
      title.includes("movie")
    ) {
      score += 5;
    }

    return { title: image.title, score };
  });

  // Sort by score and return the highest scoring image
  scoredImages.sort((a, b) => b.score - a.score);
  return scoredImages[0]?.title || null;
};

export const getWikiData = async (query, size = "1024px") => {
  console.debug(`[getWikiData] Starting with query: "${query}", size: ${size}`);
  try {
    const url = `https://en.wikipedia.org/w/rest.php/v1/search/page?format=json&q=${encodeURIComponent(
      query
    )}`;
    console.debug(`[getWikiData] Making request to: ${url}`);

    const wikiResponse = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      }
    });

    if (!wikiResponse.ok) {
      console.error(
        "[getWikiData] Wikipedia API error:",
        wikiResponse.status,
        wikiResponse.statusText
      );
      return {
        image: null,
        pageId: null
      };
    }

    const wikiData = await wikiResponse.json();
    console.debug(
      `[getWikiData] Received response with ${
        wikiData.pages?.length || 0
      } pages`
    );

    const wikiPage = wikiData.pages?.[0];
    console.debug(`[getWikiData] First page data:`, wikiPage);

    if (!wikiData?.pages || !wikiPage) {
      console.debug("[getWikiData] No pages found in response");
      return {
        image: null,
        pageId: null
      };
    }

    let image = wikiPage.thumbnail?.url?.replace(/60px/, size) || null;
    const pageId = wikiPage.id || null;
    console.debug(
      `[getWikiData] Initial thumbnail URL: ${image}, pageId: ${pageId}`
    );

    // If no thumbnail found, try to get images from the page
    if (!image && pageId) {
      console.debug(
        "[getWikiData] No thumbnail found, trying to get images from page"
      );
      const imagesUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=images&pageids=${pageId}`;
      console.debug(`[getWikiData] Fetching images from: ${imagesUrl}`);
      const imagesResponse = await fetch(imagesUrl);

      if (imagesResponse.ok) {
        const imagesData = await imagesResponse.json();
        const images = imagesData.query?.pages?.[pageId]?.images;
        console.debug(
          `[getWikiData] Found ${images?.length || 0} images on page`
        );

        if (images && images.length > 0) {
          console.debug(
            `[getWikiData] Available images:`,
            images.map((img) => img.title)
          );
          const bestImageTitle = findMostSimilarImage(query, images);
          console.debug(
            `[getWikiData] Selected best image title: ${bestImageTitle}`
          );

          if (bestImageTitle) {
            console.debug(
              `[getWikiData] Using fallback image with title: ${bestImageTitle}`
            );
            // Get the actual image URL
            const imageInfoUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=imageinfo&titles=${encodeURIComponent(
              bestImageTitle
            )}&iiprop=url`;
            console.debug(
              `[getWikiData] Fetching image info from: ${imageInfoUrl}`
            );
            const imageInfoResponse = await fetch(imageInfoUrl);

            if (imageInfoResponse.ok) {
              const imageInfoData = await imageInfoResponse.json();
              const imageInfo = Object.values(
                imageInfoData.query?.pages || {}
              )[0]?.imageinfo?.[0];
              image = imageInfo?.url || null;
              console.debug(`[getWikiData] Final image URL: ${image}`);
            }
          }
        }
      }
    }

    if (!image) {
      console.debug("[getWikiData] No image URL found after all attempts");
      return {
        image: null,
        pageId: null
      };
    }

    // Ensure the image URL is absolute
    if (image && !image.startsWith("http")) {
      image = `https:${image}`;
      console.debug(
        `[getWikiData] Converted relative URL to absolute: ${image}`
      );
    }

    console.debug(
      `[getWikiData] Successfully returning data for query: "${query}"`
    );
    return {
      image,
      pageId
    };
  } catch (error) {
    console.error("[getWikiData] Error:", error);
    return {
      image: null,
      pageId: null
    };
  }
};
