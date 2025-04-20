const getLogoDevData = async (brandName) => {
  const LOGO_DEV_PUBLISHABLE_KEY = process.env.LOGO_DEV_PUBLISHABLE_KEY;
  const LOGO_DEV_SECRET_KEY = process.env.LOGO_DEV_SECRET_KEY;
  const IMAGE_SIZE = process.env.IMAGE_SIZE;

  if (!LOGO_DEV_PUBLISHABLE_KEY || !LOGO_DEV_SECRET_KEY) {
    console.error("Missing LogoDev credentials");
    return {
      image: null,
      brandId: null
    };
  }

  try {
    const response = await fetch(
      `https://api.logo.dev/search?q=${encodeURIComponent(brandName)}`,
      {
        headers: {
          Authorization: `Bearer ${LOGO_DEV_SECRET_KEY}`
        }
      }
    );

    if (!response.ok) {
      console.error(
        `LogoDev API error: ${response.status} ${response.statusText}`
      );
      return {
        image: null,
        brandId: null
      };
    }

    const data = await response.json();

    const firstResult = data[0];

    if (!firstResult) {
      return {
        image: null,
        brandId: null
      };
    }

    const logoUrl = `https://img.logo.dev/${firstResult.domain}?token=${LOGO_DEV_PUBLISHABLE_KEY}&size=${IMAGE_SIZE}&retina=true&fallback=404`;

    return {
      image: logoUrl,
      brandId: firstResult.domain
    };
  } catch (error) {
    console.error("Error fetching logo data:", error);
    return {
      image: null,
      brandId: null
    };
  }
};

export { getLogoDevData };
