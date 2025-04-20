import { Router } from "express";
import { getUnsplashData } from "../../sources/index.js";
import { errorHandler, handleImageResponse } from "./baseTestRouter.js";

const router = Router();

router.get("/test/unsplash", async (req, res, next) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    console.log(`Testing Unsplash for query: ${query}`);
    const unsplashData = await getUnsplashData(query);
    console.log(`Unsplash response: ${JSON.stringify(unsplashData)}`);

    await handleImageResponse(unsplashData.image, res);
  } catch (error) {
    next(error);
  }
});

router.use(errorHandler);
export default router;
