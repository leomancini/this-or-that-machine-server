import { Router } from "express";
import { getLogoDevData } from "../../sources/index.js";
import { errorHandler, handleImageResponse } from "./baseTestRouter.js";

const router = Router();

router.get("/test/logodev", async (req, res, next) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    console.log(`Testing LogoDev for query: ${query}`);
    const logoDevData = await getLogoDevData(query);
    console.log(`LogoDev response: ${JSON.stringify(logoDevData)}`);

    await handleImageResponse(logoDevData.image, res);
  } catch (error) {
    next(error);
  }
});

router.use(errorHandler);
export default router;
