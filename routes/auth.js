import express from "express";

const router = express.Router();

// API Key middleware
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.query.key;
  if (!apiKey || apiKey !== process.env.APP_API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
};

// Validate API key endpoint
router.get("/validate-api-key", (req, res) => {
  const apiKey = req.query.key;
  if (!apiKey || apiKey !== process.env.APP_API_KEY) {
    return res.status(401).json({ valid: false, message: "Invalid API key" });
  }
  return res.json({ valid: true, message: "API key is valid" });
});

export { apiKeyAuth };
export default router;
