export const getBrandfetchData = async (brandName) => {
  const BRANDFETCH_CLIENT_ID = process.env.BRANDFETCH_CLIENT_ID;

  const response = await fetch(
    `https://api.brandfetch.io/v2/search/${encodeURIComponent(
      brandName
    )}?c=${BRANDFETCH_CLIENT_ID}`
  );

  const data = await response.json();
  const iconUrl = data[0]?.icon;
  const image = iconUrl
    ? iconUrl.replace(/\/w\/\d+\/h\/\d+\//, "/w/512/h/512/")
    : null;

  return {
    image,
    brandId: data[0]?.id || null
  };
};
