import OpenAI from "openai";
import VALID_TYPE_SOURCE_COMBINATIONS from "../config/types.json" assert { type: "json" };

const openai = new OpenAI();

// Helper function to generate pairs using OpenAI
export const generatePairsWithOpenAI = async (
  type,
  existingPairs,
  duplicatePairs = [],
  { count }
) => {
  const typeFilter = type ? ` of type '${type}'` : "";
  const duplicatePairsText =
    duplicatePairs.length > 0
      ? `\n\nIMPORTANT: The following pairs were already in the database. Please generate completely different pairs:\n${duplicatePairs
          .map(
            (pair) =>
              `- ${pair.type} (${pair.source}): ${pair.option_1} vs ${pair.option_2}`
          )
          .join("\n")}`
      : "";

  // Get the valid sources for the type if specified
  const typeConfig = type ? VALID_TYPE_SOURCE_COMBINATIONS[type] : null;
  const sourceFilter = typeConfig ? ` with source '${typeConfig.source}'` : "";

  // Create the prompt based on whether we're generating all types or a specific type
  const prompt = type
    ? `Generate a set of ${count} pairs${typeFilter}${sourceFilter} of two contrasting options each for a 'this or that' game. 

IMPORTANT: Each pair MUST follow this EXACT format:
{
  "type": "${type}",
  "source": "${typeConfig.source}",
  "option_1": "value1",
  "option_2": "value2"
}

Rules:
- Option values must be ${typeConfig.valueLength.min}-${
        typeConfig.valueLength.max
      } words each
- ${typeConfig.promptSupplement}

Here is an example pair for type '${type}':
${JSON.stringify(
  {
    type,
    source: typeConfig.source,
    option_1: typeConfig.examples.option_1,
    option_2: typeConfig.examples.option_2
  },
  null,
  2
)}
${
  typeConfig.bannedExamples
    ? `

CRITICAL: The following examples are STRICTLY PROHIBITED and MUST NOT be generated under any circumstances:
${typeConfig.bannedExamples.map((example) => `- ${example}`).join("\n")}

IMPORTANT: If you generate any of these banned examples, the system will reject your response. You must generate completely new and different pairs that are not similar to any of these banned examples.`
    : ""
}`
    : `Generate a set of ${count} pairs of two contrasting options each for a 'this or that' game. The pairs should be of various types: ${Object.entries(
        VALID_TYPE_SOURCE_COMBINATIONS
      )
        .map(([type, config]) => `${type} (source: ${config.source})`)
        .join(", ")}.

IMPORTANT: Each pair MUST follow this EXACT format:
{
  "type": "type_name",
  "source": "source_name",
  "option_1": "value1",
  "option_2": "value2"
}

Rules for each type:
${Object.entries(VALID_TYPE_SOURCE_COMBINATIONS)
  .map(
    ([type, config]) => `- ${type}:
  * Source: ${config.source}
  * Option values: ${config.valueLength.min}-${
      config.valueLength.max
    } words each
  * ${config.promptSupplement}
  * Example:
${JSON.stringify(
  {
    type,
    source: config.source,
    option_1: config.examples.option_1,
    option_2: config.examples.option_2
  },
  null,
  2
)}
${
  config.bannedExamples
    ? `  * CRITICAL: The following examples are STRICTLY PROHIBITED and MUST NOT be generated:
${config.bannedExamples.map((example) => `    - ${example}`).join("\n")}`
    : ""
}`
  )
  .join("\n\n")}

${
  Object.values(VALID_TYPE_SOURCE_COMBINATIONS).some(
    (config) => config.bannedExamples
  )
    ? "IMPORTANT: If you generate any of these banned examples, the system will reject your response. You must generate completely new and different pairs that are not similar to any of these banned examples."
    : ""
}`;

  const response = await openai.responses.create({
    model: "gpt-4o",
    input: [
      {
        role: "user",
        content: `${prompt}

Here are some example pairs from the database to help you understand the format and avoid generating similar pairs:
${existingPairs}${duplicatePairsText}

Note: The system will automatically check for duplicates before saving any new pairs.`
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "pairs",
        schema: {
          type: "object",
          properties: {
            pairs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string"
                  },
                  source: {
                    type: "string"
                  },
                  option_1: {
                    type: "string"
                  },
                  option_2: {
                    type: "string"
                  }
                },
                required: ["type", "source", "option_1", "option_2"],
                additionalProperties: false
              }
            }
          },
          required: ["pairs"],
          additionalProperties: false
        }
      }
    }
  });

  return response;
};
