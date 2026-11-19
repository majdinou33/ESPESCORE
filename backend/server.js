
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
app.use(express.static(__dirname));

const logoCache = new Map();
const LOGO_CACHE_TIME = 7 * 24 * 60 * 60 * 1000;

async function sportRequest(endpoint) {
  if (!API_KEY) {
    throw new Error("SPORTAPI_KEY is not configured");
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    headers: { "X-Api-Key": API_KEY },
    signal: AbortSignal.timeout(15000)
  });

  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "SportAPI request failed");
  }

  return data;
}

// Fetch events from the dedicated SportAPI endpoint.
// If unavailable, keep the events included in fixture details.
async function getFixtureEvents(fixtureId, fallbackEvents = []) {
  try {
    const data = await sportRequest(
      `/fixtures/${fixtureId}/events`
    );

    if (Array.isArray(data.data)) {
      return {
        events: data.data,
        source: "events_endpoint"
      };
    }
  } catch (error) {
    console.error(
      `Events endpoint error for ${fixtureId}:`,
      error.message
    );
  }

  return {
    events: Array.isArray(fallbackEvents) ? fallbackEvents : [],
    source: "fixture_fallback"
  };
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

function mapEvent(event) {
  return {
    ...event,
    id: event.id ?? null,
    type: event.event_type || event.type || "other",
    team: event.team_side || event.team || "",
    player: event.player_name || event.player || "",
    minute: event.minute || "",
    detail: event.extra_info || event.detail || ""
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
        logo: match.home_id ? `/team-logo/${match.home_id}` : ""
      },
      away: {
        id: match.away_id,
        name: match.away_team || "Away",
        logo: match.away_id ? `/team-logo/${match.away_id}` : ""
      }
    },
    goals: {
      home: match.home_score ?? null,
      away: match.away_score ?? null
    },
    events: Array.isArray(match.events)
      ? match.events.map(mapEvent)
      : []
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

// Fixtures
app.get("/fixtures", async (req, res) => {
  try {
    const date = req.query.date;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date" });
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

// Live matches
app.get("/live", async (req, res) => {
  try {
    const data = await sportRequest(
      `/fixtures/date/${tunisianDate()}`
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

// Diagnostic: test the dedicated events endpoint
app.get("/debug/events", async (req, res) => {
  try {
    const requestedId = req.query.fixture
      ? Number(req.query.fixture)
      : null;

    let matches = [];

    if (requestedId) {
      if (!Number.isSafeInteger(requestedId) || requestedId <= 0) {
        return res.status(400).json({
          error: "Invalid fixture ID"
        });
      }

      const detail = await sportRequest(
        `/fixtures/${requestedId}`
      );

      if (detail.fixture) {
        matches.push(detail.fixture);
      } else {
        matches.push({ id: requestedId });
      }

    } else {
      const date = tunisianDate();

      const data = await sportRequest(
        `/fixtures/date/${date}`
      );

      matches = Array.isArray(data.data) ? data.data : [];
    }

    const eventFields = new Set();
    const substitutionMatches = [];
    const matchesWithEvents = [];
    const errors = [];

    let matchesChecked = 0;
    let eventsFound = 0;

    for (const match of matches) {
      if (!match.id) continue;

      try {
        const result = await getFixtureEvents(
          Number(match.id),
          match.events
        );

        const events = result.events;

        matchesChecked++;

        if (events.length > 0) {
          matchesWithEvents.push({
            fixture_id: match.id,
            home: match.home_team || "",
            away: match.away_team || "",
            events_count: events.length,
            source: result.source
          });
        }

        for (const event of events) {
          eventsFound++;

          Object.keys(event).forEach(key => {
            eventFields.add(key);
          });

          const eventType = String(
            event.event_type || event.type || ""
          ).toLowerCase();

          const eventText = JSON.stringify(event).toLowerCase();

          if (
            eventType.includes("sub") ||
            eventType.includes("substitution") ||
            eventText.includes("substitution")
          ) {
            substitutionMatches.push({
              fixture_id: match.id,
              home: match.home_team || "",
              away: match.away_team || "",
              event
            });
          }
        }

      } catch (error) {
        errors.push({
          fixture_id: match.id,
          error: error.message
        });
      }
    }

    res.json({
      date: tunisianDate(),
      matches_found: matches.length,
      matches_checked: matchesChecked,
      events_found: eventsFound,
      event_fields: [...eventFields],
      matches_with_events: matchesWithEvents,
      substitution_matches: substitutionMatches,
      errors
    });

  } catch (error) {
    console.error("Debug events error:", error.message);
    res.status(500).json({
      error: "Unable to inspect match events"
    });
  }
});

// Team logos
app.get("/team-logo/:id", async (req, res) => {
  try {
    const teamId = Number(req.params.id);

    if (!Number.isSafeInteger(teamId) || teamId <= 0) {
      return res.status(400).end();
    }

    const cached = logoCache.get(teamId);

    if (cached && cached.expiresAt > Date.now()) {
      res.set("Cache-Control", "public, max-age=604800");
      res.set("Content-Type", cached.contentType);
      return res.send(cached.buffer);
    }

    if (!API_KEY) {
      throw new Error("SPORTAPI_KEY is not configured");
    }

    const response = await fetch(
      `${API_URL}/teams/${teamId}/logo`,
      {
        headers: { "X-Api-Key": API_KEY },
        signal: AbortSignal.timeout(15000)
      }
    );

    if (!response.ok) return res.status(404).end();

    const contentType =
      response.headers.get("content-type") || "image/png";

    if (!contentType.startsWith("image/")) {
      return res.status(502).end();
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (logoCache.size >= 500) {
      const firstKey = logoCache.keys().next().value;
      logoCache.delete(firstKey);
    }

    logoCache.set(teamId, {
      buffer,
      contentType,
      expiresAt: Date.now() + LOGO_CACHE_TIME
    });

    res.set("Cache-Control", "public, max-age=604800");
    res.set("Content-Type", contentType);
    res.send(buffer);

  } catch (error) {
    console.error("Team logo error:", error.message);
    res.status(502).end();
  }
});

// Fixture details with dedicated events endpoint
app.get("/fixture/:id", async (req, res) => {
  try {
    const fixtureId = Number(req.params.id);

    if (!Number.isSafeInteger(fixtureId) || fixtureId <= 0) {
      return res.status(400).json({
        error: "Invalid fixture ID"
      });
    }

    const data = await sportRequest(
      `/fixtures/${fixtureId}`
    );

    if (!data.fixture) {
      return res.status(404).json({
        error: "Fixture not found"
      });
    }

    const result = await getFixtureEvents(
      fixtureId,
      data.fixture.events
    );

    const fixture = {
      ...data.fixture,
      events: result.events
    };

    res.json({
      response: [mapFixture(fixture)]
    });

  } catch (error) {
    console.error("Fixture details error:", error.message);
    res.status(500).json({
      error: "Unable to load fixture details"
    });
  }
});

// Health
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    project: "ESPESCORE",
    api: "SportAPI"
  });
});

// Home
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`ESPESCORE running on port ${PORT}`);
});
