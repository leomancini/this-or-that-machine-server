import express from "express";
import { supabase } from "../config/supabase.js";
import { broadcast } from "../utils/broadcast.js";

const router = express.Router();

// Vote endpoint
router.get("/vote", async (req, res) => {
  try {
    const { id, option } = req.query;

    if (!id || !option) {
      return res.status(400).json({ error: "id and option are required" });
    }

    if (option !== "1" && option !== "2") {
      return res.status(400).json({ error: "option must be 1 or 2" });
    }

    const { data: pair, error: pairError } = await supabase
      .from("pairs")
      .select("id, option_1_value, option_2_value, option_1_url, option_2_url")
      .eq("id", id)
      .single();

    if (pairError || !pair) {
      return res.status(404).json({ error: "Pair not found" });
    }

    const { data: existingVotes, error: voteError } = await supabase
      .from("votes")
      .select("*")
      .eq("option_1_value", pair.option_1_value)
      .eq("option_2_value", pair.option_2_value)
      .single();

    if (voteError && voteError.code !== "PGRST116") {
      throw voteError;
    }

    let voteData;
    if (existingVotes) {
      const updateData = {
        option_1_count:
          option === "1"
            ? existingVotes.option_1_count + 1
            : existingVotes.option_1_count,
        option_2_count:
          option === "2"
            ? existingVotes.option_2_count + 1
            : existingVotes.option_2_count,
        pair_id: pair.id
      };

      const { error: updateError } = await supabase
        .from("votes")
        .update(updateData)
        .eq("id", existingVotes.id);

      if (updateError) {
        throw updateError;
      }

      voteData = {
        ...existingVotes,
        ...updateData
      };
    } else {
      const newVote = {
        option_1_value: pair.option_1_value,
        option_2_value: pair.option_2_value,
        option_1_count: option === "1" ? 1 : 0,
        option_2_count: option === "2" ? 1 : 0,
        pair_id: pair.id
      };

      const { data, error: insertError } = await supabase
        .from("votes")
        .insert([newVote])
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }
      voteData = data;
    }

    broadcast({
      type: "vote",
      data: {
        pair_id: pair.id,
        option_1: {
          value: pair.option_1_value,
          count: voteData.option_1_count,
          url: pair.option_1_url
        },
        option_2: {
          value: pair.option_2_value,
          count: voteData.option_2_count,
          url: pair.option_2_url
        }
      }
    });

    return res.json({
      message: "Vote processed successfully",
      votes: voteData
    });
  } catch (error) {
    console.error("Error processing vote:", error.message);
    res.status(500).json({ error: "Failed to process vote" });
  }
});

// Get all votes endpoint
router.get("/get-all-votes", async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    const { data: votes, error: votesError } = await supabase
      .from("votes")
      .select("*");

    if (votesError) {
      throw votesError;
    }

    const pairIds = votes.map((vote) => vote.pair_id);
    const { data: pairs, error: pairsError } = await supabase
      .from("pairs")
      .select("id, option_1_value, option_2_value, option_1_url, option_2_url")
      .in("id", pairIds)
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (pairsError) {
      throw pairsError;
    }

    const votesMap = new Map();
    votes.forEach((vote) => {
      votesMap.set(vote.pair_id, vote);
    });

    const formattedVotes = pairs
      .map((pair) => {
        const voteData = votesMap.get(pair.id);

        const totalVotes = voteData.option_1_count + voteData.option_2_count;
        const majority = Math.abs(
          voteData.option_1_count - voteData.option_2_count
        );
        const winningPercentage =
          totalVotes > 0
            ? Math.max(
                voteData.option_1_count / totalVotes,
                voteData.option_2_count / totalVotes
              )
            : 0;

        return {
          option_1: {
            value: pair.option_1_value,
            count: voteData.option_1_count,
            url: pair.option_1_url
          },
          option_2: {
            value: pair.option_2_value,
            count: voteData.option_2_count,
            url: pair.option_2_url
          },
          total_votes: totalVotes,
          majority: majority,
          winning_percentage: winningPercentage
        };
      })
      .sort((a, b) => {
        if (b.winning_percentage !== a.winning_percentage) {
          return b.winning_percentage - a.winning_percentage;
        }
        return b.total_votes - a.total_votes;
      })
      .map(({ option_1, option_2 }) => ({ option_1, option_2 }));

    const { count, error: countError } = await supabase
      .from("pairs")
      .select("*", { count: "exact", head: true })
      .in("id", pairIds);

    if (countError) {
      throw countError;
    }

    res.json({
      votes: formattedVotes,
      total: count,
      has_more: parseInt(offset) + parseInt(limit) < count
    });
  } catch (error) {
    console.error("Error fetching votes:", error);
    res.status(500).json({ error: "Failed to fetch votes" });
  }
});

// Get random pair with votes endpoint
router.get("/get-random-pair-votes", async (req, res) => {
  try {
    const { data: pairsWithVotes, error: pairsError } = await supabase
      .from("pairs")
      .select(
        "id, type, source, option_1_value, option_2_value, option_1_url, option_2_url, created_at"
      )
      .in(
        "id",
        (
          await supabase
            .from("votes")
            .select("pair_id")
            .gt("option_1_count", 0)
            .or("option_2_count.gt.0")
        ).data.map((vote) => vote.pair_id)
      );

    if (pairsError) {
      throw pairsError;
    }

    if (!pairsWithVotes || pairsWithVotes.length === 0) {
      return res.status(404).json({ error: "No pairs with votes found" });
    }

    const randomPair =
      pairsWithVotes[Math.floor(Math.random() * pairsWithVotes.length)];

    const { data: votes, error: votesError } = await supabase
      .from("votes")
      .select("option_1_count, option_2_count")
      .eq("pair_id", randomPair.id)
      .single();

    if (votesError && votesError.code !== "PGRST116") {
      throw votesError;
    }

    const formattedResponse = {
      id: randomPair.id,
      options: [
        {
          value: randomPair.option_1_value,
          url: randomPair.option_1_url,
          votes: votes?.option_1_count || 0
        },
        {
          value: randomPair.option_2_value,
          url: randomPair.option_2_url,
          votes: votes?.option_2_count || 0
        }
      ]
    };

    res.json(formattedResponse);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to fetch random pair votes" });
  }
});

export default router;
