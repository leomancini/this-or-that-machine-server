import sharp from "sharp";

export const getBrandfetchData = async (brandName) => {
  const BRANDFETCH_CLIENT_ID = process.env.BRANDFETCH_CLIENT_ID;
  const BRANDFETCH_API_KEY = process.env.BRANDFETCH_API_KEY;

  if (!BRANDFETCH_CLIENT_ID || !BRANDFETCH_API_KEY) {
    console.error("Missing Brandfetch credentials");
    return {
      image: null,
      brandId: null
    };
  }

  try {
    // First, get the brand ID from search
    console.log(`Searching for brand: ${brandName}`);
    const searchResponse = await fetch(
      `https://api.brandfetch.io/v2/search/${encodeURIComponent(
        brandName
      )}?c=${BRANDFETCH_CLIENT_ID}`,
      {
        headers: {
          Authorization: `Bearer ${BRANDFETCH_API_KEY}`
        }
      }
    );

    if (!searchResponse.ok) {
      console.error(
        "Search API error:",
        searchResponse.status,
        searchResponse.statusText
      );
      return {
        image: null,
        brandId: null
      };
    }

    const searchData = await searchResponse.json();

    // Get the first result's brandId
    const brandId = searchData[0]?.brandId;

    if (!brandId) {
      console.log("No brand ID found for:", brandName);
      return {
        image: null,
        brandId: null
      };
    }

    // Then, get detailed brand info
    console.log(`Fetching details for brand ID: ${brandId}`);
    const brandResponse = await fetch(
      `https://api.brandfetch.io/v2/brands/${brandId}?c=${BRANDFETCH_CLIENT_ID}`,
      {
        headers: {
          Authorization: `Bearer ${BRANDFETCH_API_KEY}`
        }
      }
    );

    if (!brandResponse.ok) {
      console.error(
        "Brand details API error:",
        brandResponse.status,
        brandResponse.statusText
      );
      return {
        image: null,
        brandId: null
      };
    }

    const brandData = await brandResponse.json();

    // Find the highest resolution dark theme PNG or JPG logo
    const logos = brandData.logos || [];
    let logoUrl = null;
    let maxWidth = 0;

    for (const logo of logos) {
      // Only look at dark theme logos
      if (logo.theme !== "dark") continue;

      const formats = logo.formats || [];
      for (const format of formats) {
        // Skip transparent backgrounds
        if (format.background === "transparent") continue;

        if (
          (format.format === "png" ||
            format.format === "jpg" ||
            format.format === "jpeg") &&
          format.width > maxWidth
        ) {
          maxWidth = format.width;
          logoUrl = format.src;
        }
      }
    }

    if (!logoUrl) {
      console.log("No suitable dark theme logo found for brand:", brandName);
      return {
        image: null,
        brandId: null
      };
    }

    console.log(`Found logo with width: ${maxWidth}px`);
    return {
      image: logoUrl,
      brandId
    };
  } catch (error) {
    console.error("Error in getBrandfetchData:", error);
    return {
      image: null,
      brandId: null
    };
  }
};
