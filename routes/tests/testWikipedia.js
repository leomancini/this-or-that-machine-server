import { Router } from "express";
import { getWikiData } from "../../sources/index.js";
import { errorHandler, handleImageResponse } from "./baseTestRouter.js";

const router = Router();

router.get("/test/wikipedia", async (req, res, next) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    console.log(`Testing Wikipedia for query: ${query}`);
    const wikiData = await getWikiData(query);
    console.log(`Wikipedia response: ${JSON.stringify(wikiData)}`);

    await handleImageResponse(wikiData.image, res);
  } catch (error) {
    next(error);
  }
});

router.use(errorHandler);
export default router;
