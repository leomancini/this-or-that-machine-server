export const getWikiData = async (query, size = "1024px") => {
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

  const wikiData = await wikiResponse.json();
  const wikiPage = wikiData.pages?.[0];

  if (!wikiData?.pages || !wikiPage) {
    return {
      image: null,
      pageId: null
    };
  }

  return {
    image: wikiPage.thumbnail?.url?.replace(/60px/, size) || null,
    pageId: wikiPage.id || null
  };
};
