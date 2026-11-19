
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.SPORTAPI_KEY;
const API_URL = "https://sportapi.ai/api";

app.use(cors());
app.use(express.json());

async function sportRequest(endpoint) {
  if (!API_KEY) {
    throw new Error("SPORTAPI_KEY is not configured");
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    headers: {
      "X-Api-Key": API_KEY
    },
    signal: AbortSignal.timeout(15000)
  });

  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "SportAPI request failed");
  }

  return data;
}

function mapStatus(status, minute) {
  const value = String(status || "").toUpperCase();

  const codes = {
    SCHEDULED: "NS",
    LIVE: "LIVE",
    FT: "FT",
    AET: "AET",
    PENS: "PEN",
    POSTPONED: "PST",
    CANCELLED: "CANC",
    SUSPENDED: "SUSP"
  };

  let elapsed = null;

  if (minute && minute !== "HT") {
    const parsed = parseInt(minute, 10);
    if (!Number.isNaN(parsed)) elapsed = parsed;
  }

  return {
    short: minute === "HT" ? "HT" : (codes[value] || value),
    long: value,
    elapsed
  };
}

function mapFixture(match) {
  return {
    fixture: {
      id: match.id,
      date: match.kickoff_utc || match.datetime,
      status: mapStatus(match.status, match.minute)
    },

    league: {
      id: match.league_id,
      name: match.league_name || "Unknown League",
      country: match.league_zone || match.league_geo || ""
    },

    teams: {
      home: {
        id: match.home_id,
        name: match.home_team || "Home",
        logo: "about:blank"
      },
      away: {
        id: match.away_id,
        name: match.away_team || "Away",
        logo: "about:blank"
      }
    },

    goals: {
      home: match.home_score ?? null,
      away: match.away_score ?? null
    }
  };
}

function tunisianDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tunis",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

app.get("/fixtures", async (req, res) => {
  try {
    const date = req.query.date;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: "Invalid date"
      });
    }

    const data = await sportRequest(
      `/fixtures/date/${encodeURIComponent(date)}`
    );

    const matches = Array.isArray(data.data) ? data.data : [];

    res.json({
      response: matches.map(mapFixture)
    });

  } catch (error) {
    console.error("Fixtures error:", error.message);

    res.status(500).json({
      error: "Unable to load matches"
    });
  }
});

app.get("/live", async (req, res) => {
  try {
    const date = tunisianDate();

    const data = await sportRequest(
      `/fixtures/date/${date}`
    );

    const matches = Array.isArray(data.data) ? data.data : [];

    const liveMatches = matches.filter(match =>
      String(match.status).toUpperCase() === "LIVE"
    );

    res.json({
      response: liveMatches.map(mapFixture)
    });

  } catch (error) {
    console.error("Live error:", error.message);

    res.status(500).json({
      error: "Unable to load live matches"
    });
  }
});

app.get("/fixture/:id", async (req, res) => {
  try {
    const fixtureId = Number(req.params.id);

    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      return res.status(400).json({
        error: "Invalid fixture ID"
      });
    }

    const data = await sportRequest(`/fixtures/${fixtureId}`);

    if (!data.fixture) {
      return res.status(404).json({
        error: "Fixture not found"
      });
    }

    res.json({
      response: [mapFixture(data.fixture)]
    });

  } catch (error) {
    console.error("Fixture details error:", error.message);

    res.status(500).json({
      error: "Unable to load fixture details"
    });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    project: "ESPESCORE",
    api: "SportAPI"
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`ESPESCORE running on port ${PORT}`);
});
