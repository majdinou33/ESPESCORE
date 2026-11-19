
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.API_FOOTBALL_KEY;
const API_URL = "https://v3.football.api-sports.io";

app.use(cors());
app.use(express.json());

async function getFixtures(params) {
  if (!API_KEY) {
    throw new Error("API_FOOTBALL_KEY is not configured");
  }

  const query = new URLSearchParams(params);

  const response = await fetch(
    `${API_URL}/fixtures?${query.toString()}`,
    {
      headers: {
        "x-apisports-key": API_KEY
      },
      signal: AbortSignal.timeout(15000)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message || "Football API request failed"
    );
  }

  return data;
}

app.get("/fixtures", async (req, res) => {
  try {
    const date = req.query.date;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: "Invalid date"
      });
    }

    const data = await getFixtures({ date });

    res.json(data);

  } catch (error) {
    console.error("Fixtures error:", error.message);

    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/live", async (req, res) => {
  try {
    const data = await getFixtures({
      live: "all"
    });

    res.json(data);

  } catch (error) {
    console.error("Live error:", error.message);

    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    project: "ESPESCORE"
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`ESPESCORE running on port ${PORT}`);
});

