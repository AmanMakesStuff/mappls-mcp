#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";

const API_KEY = process.env.MAPPLS_API_KEY;

if (!API_KEY) {
  console.error(
    "Error: MAPPLS_API_KEY environment variable is not set.\n" +
    "Get your free API key at https://maps.mappls.com/api\n" +
    "Then set: export MAPPLS_API_KEY=your_key"
  );
  process.exit(1);
}

async function mapplsGet(baseUrl: string, params: Record<string, string> = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set("access_token", API_KEY!);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (res.status === 204) return { results: [], message: "No results found" };
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mappls API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function mapplsPost(baseUrl: string, body: Record<string, unknown>) {
  const url = new URL(baseUrl);
  url.searchParams.set("access_token", API_KEY!);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mappls API error ${res.status}: ${text}`);
  }
  return res.json();
}

// route.mappls.com APIs use lng,lat order (not lat,lng)
function toRoutingCoords(point: string) {
  const [lat, lng] = point.split(",").map((s) => s.trim());
  return `${lng},${lat}`;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const tools = [
  // ── Search & Geocoding ───────────────────────────────────────────────────────
  {
    name: "geocode",
    description:
      "Convert an Indian address or place name into latitude/longitude coordinates. Works with full addresses, landmarks, cities, and pincodes.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Full address or place name (e.g. 'India Gate, New Delhi' or '110001')",
        },
        itemCount: { type: "number", description: "Max results to return (default 5)" },
      },
      required: ["address"],
    },
  },
  {
    name: "reverse_geocode",
    description: "Convert latitude/longitude coordinates into a human-readable Indian address.",
    inputSchema: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Latitude" },
        lng: { type: "number", description: "Longitude" },
      },
      required: ["lat", "lng"],
    },
  },
  {
    name: "autosuggest",
    description:
      "Get autocomplete suggestions for an address or place as the user types. Returns a list of matching places with their eLoc codes.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Partial address or place name to autocomplete" },
        lat: { type: "number", description: "Bias results near this latitude (optional)" },
        lng: { type: "number", description: "Bias results near this longitude (optional)" },
        region: { type: "string", description: "Country code (default: IND)" },
      },
      required: ["query"],
    },
  },
  {
    name: "text_search",
    description:
      "Search for places in India by keyword, category, or brand name (e.g. 'Starbucks Delhi', 'petrol pump Mumbai').",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword or place name" },
        region: { type: "string", description: "Country code (default: IND)" },
        filter: {
          type: "string",
          description: "Filter results e.g. 'pin:110020' to restrict to a pincode",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "nearby_search",
    description:
      "Find points of interest near a location in India — hospitals, ATMs, restaurants, petrol pumps, schools, etc.",
    inputSchema: {
      type: "object",
      properties: {
        keywords: {
          type: "string",
          description: "Category or keyword (e.g. 'hospital', 'atm', 'restaurant', 'petrol pump')",
        },
        lat: { type: "number", description: "Reference latitude" },
        lng: { type: "number", description: "Reference longitude" },
        radius: {
          type: "number",
          description: "Search radius in metres (default 1000, max 10000)",
        },
        sortBy: {
          type: "string",
          enum: ["dist:asc", "dist:desc", "imp"],
          description: "Sort order — dist:asc (nearest first), imp (most prominent first)",
        },
      },
      required: ["keywords", "lat", "lng"],
    },
  },
  {
    name: "place_details",
    description:
      "Get full details (name, address, category, contact, hours) for a place using its Mappls eLoc code. eLoc codes are returned by autosuggest, nearby_search, and text_search.",
    inputSchema: {
      type: "object",
      properties: {
        eLoc: {
          type: "string",
          description: "Mappls eLoc code (6-character place ID, e.g. 'MMI000', '17ZUL7')",
        },
      },
      required: ["eLoc"],
    },
  },
  {
    name: "address_analytics",
    description:
      "Analyze and standardize an Indian address — breaks it into structured components (house number, street, locality, district, state, pincode).",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Raw address string to analyze and standardize" },
      },
      required: ["address"],
    },
  },

  // ── Routing & Navigation ─────────────────────────────────────────────────────
  {
    name: "get_directions",
    description:
      "Get turn-by-turn driving/biking/walking directions between two points in India, including distance, duration, and step-by-step instructions.",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Start point as 'lat,lng'" },
        destination: { type: "string", description: "End point as 'lat,lng'" },
        profile: {
          type: "string",
          enum: ["driving", "biking", "walking"],
          description: "Travel mode (default: driving)",
        },
      },
      required: ["origin", "destination"],
    },
  },
  {
    name: "get_directions_with_traffic",
    description:
      "Get directions with real-time traffic-aware ETA. Returns predictive travel time based on current traffic conditions.",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Start point as 'lat,lng'" },
        destination: { type: "string", description: "End point as 'lat,lng'" },
        profile: {
          type: "string",
          enum: ["driving", "trucking", "biking", "walking"],
          description: "Travel mode (default: driving)",
        },
      },
      required: ["origin", "destination"],
    },
  },
  {
    name: "distance_matrix",
    description:
      "Calculate distances and travel times between multiple points. First coordinate is the origin; all others are destinations. Returns a matrix of distances and durations.",
    inputSchema: {
      type: "object",
      properties: {
        coordinates: {
          type: "string",
          description:
            "Semicolon-separated lat,lng points. e.g. '28.55,77.13;28.48,77.05;28.63,77.21' (min 2 points)",
        },
        profile: {
          type: "string",
          enum: ["driving", "biking", "walking"],
          description: "Travel mode (default: driving)",
        },
      },
      required: ["coordinates"],
    },
  },
  {
    name: "distance_matrix_with_traffic",
    description:
      "Calculate distances and traffic-aware ETAs between multiple points using real-time traffic data.",
    inputSchema: {
      type: "object",
      properties: {
        coordinates: {
          type: "string",
          description: "Semicolon-separated lat,lng points (min 2). e.g. '28.55,77.13;28.48,77.05'",
        },
        profile: {
          type: "string",
          enum: ["driving", "trucking", "biking", "walking"],
          description: "Travel mode (default: driving)",
        },
      },
      required: ["coordinates"],
    },
  },
  {
    name: "poi_along_route",
    description:
      "Find points of interest along a route — useful for finding fuel stations, restaurants, or ATMs on the way from A to B. Requires the encoded polyline from get_directions.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Encoded polyline geometry string (from the 'geometry' field of get_directions response)",
        },
        category: {
          type: "string",
          description:
            "POI category code (e.g. 'FODCOF' for food & coffee, 'FINATM' for ATMs, 'PETPTM' for petrol pumps)",
        },
        buffer: {
          type: "number",
          description: "Search buffer in metres on each side of the route (default 300)",
        },
      },
      required: ["path", "category"],
    },
  },
  {
    name: "snap_to_road",
    description:
      "Snap a series of GPS coordinates to the nearest road. Useful for cleaning up raw GPS traces from a device.",
    inputSchema: {
      type: "object",
      properties: {
        points: {
          type: "string",
          description:
            "Semicolon-separated lat,lng GPS points to snap to roads. e.g. '28.55,77.13;28.56,77.14'",
        },
      },
      required: ["points"],
    },
  },

  // ── Utilities ────────────────────────────────────────────────────────────────
  {
    name: "elevation",
    description:
      "Get the elevation (altitude above sea level in metres) for one or more lat/lng points.",
    inputSchema: {
      type: "object",
      properties: {
        locations: {
          type: "string",
          description:
            "Pipe-separated lat,lng points. e.g. '28.55,77.20|19.07,72.87' (Delhi and Mumbai)",
        },
      },
      required: ["locations"],
    },
  },
  {
    name: "aerial_distance",
    description:
      "Get the straight-line (crow-fly) distance between two geographic points. Faster than routing for simple distance checks.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start point as 'lat,lng'" },
        to: { type: "string", description: "End point as 'lat,lng'" },
        unit: {
          type: "string",
          enum: ["K", "M", "N"],
          description: "Unit: K = kilometres, M = miles, N = nautical miles (default: K)",
        },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "still_map_image",
    description:
      "Generate a static map image URL centered on a location. Returns a URL to a PNG map image — useful for embedding maps in reports or sending via WhatsApp/email.",
    inputSchema: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Center latitude" },
        lng: { type: "number", description: "Center longitude" },
        zoom: { type: "number", description: "Zoom level 4–18 (default 15)" },
        width: { type: "number", description: "Image width in pixels (default 800)" },
        height: { type: "number", description: "Image height in pixels (default 600)" },
        markers: {
          type: "string",
          description: "Optional marker as 'lat,lng' to pin on the map",
        },
      },
      required: ["lat", "lng"],
    },
  },
  {
    name: "validate_pincode",
    description:
      "Validate an Indian 6-digit pincode and get the associated district, city, and state information.",
    inputSchema: {
      type: "object",
      properties: {
        pincode: { type: "string", description: "6-digit Indian pincode" },
      },
      required: ["pincode"],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "geocode":
      return mapplsGet("https://search.mappls.com/search/address/geocode", {
        address: String(args.address),
        itemCount: String(args.itemCount ?? 5),
      });

    case "reverse_geocode":
      return mapplsGet("https://search.mappls.com/search/address/rev-geocode", {
        lat: String(args.lat),
        lng: String(args.lng),
      });

    case "autosuggest": {
      const params: Record<string, string> = { query: String(args.query) };
      if (args.lat && args.lng) params.location = `${args.lat},${args.lng}`;
      if (args.region) params.region = String(args.region);
      return mapplsGet("https://search.mappls.com/search/places/autosuggest/json", params);
    }

    case "text_search": {
      const params: Record<string, string> = { query: String(args.query) };
      if (args.region) params.region = String(args.region);
      if (args.filter) params.filter = String(args.filter);
      return mapplsGet("https://search.mappls.com/search/places/textsearch/json", params);
    }

    case "nearby_search": {
      const params: Record<string, string> = {
        keywords: String(args.keywords),
        refLocation: `${args.lat},${args.lng}`,
        radius: String(args.radius ?? 1000),
      };
      if (args.sortBy) params.sortBy = String(args.sortBy);
      return mapplsGet("https://search.mappls.com/search/places/nearby/json", params);
    }

    case "place_details":
      return mapplsGet(`https://place.mappls.com/O2O/entity/place-details/${args.eLoc}`);

    case "address_analytics":
      return mapplsGet("https://search.mappls.com/search/address/addressAnalytics", {
        address: String(args.address),
      });

    case "get_directions": {
      const origin = toRoutingCoords(String(args.origin));
      const dest = toRoutingCoords(String(args.destination));
      const profile = String(args.profile ?? "driving");
      return mapplsGet(
        `https://route.mappls.com/route/direction/route_adv/${profile}/${origin};${dest}`,
        { overview: "full", steps: "true" }
      );
    }

    case "get_directions_with_traffic": {
      const origin = toRoutingCoords(String(args.origin));
      const dest = toRoutingCoords(String(args.destination));
      return mapplsGet("https://route.mappls.com/routev2/direction/route", {
        locations: `${origin};${dest}`,
        profile: String(args.profile ?? "driving"),
        speedTypes: "traffic",
      });
    }

    case "distance_matrix": {
      const points = String(args.coordinates).split(";").map((p) => p.trim());
      if (points.length < 2) throw new Error("Provide at least 2 semicolon-separated coordinates");
      const coords = points.map(toRoutingCoords).join(";");
      const profile = String(args.profile ?? "driving");
      return mapplsGet(
        `https://route.mappls.com/route/dm/distance_matrix/${profile}/${coords}`
      );
    }

    case "distance_matrix_with_traffic": {
      const points = String(args.coordinates).split(";").map((p) => p.trim());
      if (points.length < 2) throw new Error("Provide at least 2 semicolon-separated coordinates");
      const coords = points.map(toRoutingCoords).join(";");
      return mapplsGet("https://route.mappls.com/routev2/dm/distance", {
        source: coords,
        target: coords,
        profile: String(args.profile ?? "driving"),
        speedTypes: "traffic",
      });
    }

    case "poi_along_route": {
      return mapplsGet("https://search.mappls.com/search/places/along-route", {
        path: String(args.path),
        category: String(args.category),
        buffer: String(args.buffer ?? 300),
      });
    }

    case "snap_to_road": {
      const points = String(args.points)
        .split(";")
        .map((p) => {
          const [lat, lng] = p.trim().split(",").map(Number);
          return { lat, lng };
        });
      return mapplsPost("https://route.mappls.com/routev2/movement/trace_route", {
        points,
        type: 1,
      });
    }

    case "elevation":
      return mapplsGet("https://sdk.mappls.com/map/utils/elevation", {
        locations: String(args.locations),
      });

    case "aerial_distance":
      return mapplsGet("https://tile.mappls.com/map/raster_tile/distanceA", {
        from: String(args.from),
        to: String(args.to),
        unit: String(args.unit ?? "K"),
      });

    case "still_map_image": {
      const params: Record<string, string> = {
        center: `${args.lng},${args.lat}`,
        zoom: String(args.zoom ?? 15),
        size: `${args.width ?? 800}x${args.height ?? 600}`,
      };
      if (args.markers) params.markers = `color:red|${args.lat},${args.lng}`;
      const url = new URL("https://tile.mappls.com/map/raster_tile/still_image");
      url.searchParams.set("access_token", API_KEY!);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      return { image_url: url.toString() };
    }

    case "validate_pincode": {
      const pincode = String(args.pincode);
      if (!/^\d{6}$/.test(pincode)) return { valid: false, error: "Pincode must be exactly 6 digits" };
      return mapplsGet("https://search.mappls.com/search/address/geocode", { address: pincode });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "mappls-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, (args ?? {}) as Record<string, unknown>);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Mappls MCP server running — 18 tools available");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
