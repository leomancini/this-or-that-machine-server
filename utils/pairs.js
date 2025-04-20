import { supabase } from "../config/supabase.js";

// Helper function to transform OpenAI response to database format
export const transformPairsForDatabase = (pairs) => {
  return pairs.map((pair) => ({
    type: pair.type,
    source: pair.source,
    option_1_value: pair.option_1,
    option_2_value: pair.option_2
  }));
};

// Helper function to save pairs to database
export const savePairsToDatabase = async (pairs) => {
  const insertedPairs = [];
  const duplicatePairs = [];

  for (const pair of pairs) {
    // Check if pair already exists in any direction
    const { data: existingPairs, error: checkError } = await supabase
      .from("pairs")
      .select("id")
      .eq("type", pair.type)
      .or(
        `and(option_1_value.eq.${pair.option_1_value},option_2_value.eq.${pair.option_2_value}),` +
          `and(option_1_value.eq.${pair.option_2_value},option_2_value.eq.${pair.option_1_value})`
      );

    if (checkError) {
      throw checkError;
    }

    if (existingPairs && existingPairs.length > 0) {
      duplicatePairs.push(pair);
      continue;
    }

    const { data, error } = await supabase.from("pairs").insert([
      {
        type: pair.type,
        source: pair.source,
        option_1_value: pair.option_1_value,
        option_2_value: pair.option_2_value,
        created_at: new Date().toISOString()
      }
    ]);

    if (error) {
      throw error;
    }

    insertedPairs.push(pair);
  }

  return { insertedPairs, duplicatePairs };
};
