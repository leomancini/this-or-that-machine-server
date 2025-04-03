export const getWikiData = async (query, size = "1024px") => {
  try {
    console.log(`Searching Wikipedia for: ${query}`);
    const wikiResponse = await fetch(
      `https://en.wikipedia.org/w/rest.php/v1/search/page?format=json&q=${encodeURIComponent(
        query
      )}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5"
        }
      }
    );

    if (!wikiResponse.ok) {
      console.error(
        "Wikipedia API error:",
        wikiResponse.status,
        wikiResponse.statusText
      );
      return {
        image: null,
        pageId: null
      };
    }

    const wikiData = await wikiResponse.json();
    const wikiPage = wikiData.pages?.[0];

    if (!wikiData?.pages || !wikiPage) {
      console.log("No Wikipedia page found for:", query);
      return {
        image: null,
        pageId: null
      };
    }

    let image = wikiPage.thumbnail?.url?.replace(/60px/, size) || null;
    const pageId = wikiPage.id || null;

    if (!image) {
      console.log("No thumbnail found for Wikipedia page:", query);
      return {
        image: null,
        pageId: null
      };
    }

    // Ensure the image URL is absolute
    if (image && !image.startsWith("http")) {
      image = `https:${image}`;
    }

    return {
      image,
      pageId
    };
  } catch (error) {
    console.error("Error in getWikiData:", error);
    return {
      image: null,
      pageId: null
    };
  }
};
