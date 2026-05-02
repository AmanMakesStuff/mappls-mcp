#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import { z } from "zod";

const API_KEY = process.env.MAPPLS_API_KEY;

if (!API_KEY) {
  console.error("Error: MAPPLS_API_KEY environment variable is required");
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

// lat,lng → lng,lat for route.mappls.com APIs
function toRoutingCoords(point: string) {
  const [lat, lng] = point.split(",").map((s) => s.trim());
  return `${lng},${lat}`;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const tools = [
  {
    name: "geocode",
    description: "Convert an Indian address or place name into latitude/longitude coordinates.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Full address or place name (e.g. 'India Gate, New Delhi')" },
        itemCount: { type: "number", description: "Max results (default 5)" },
      },
      required: ["address"],
    },
  },
  {
    name: "reverse_geocode",
    description: "Convert lat/lng coordinates into a human-readable Indian address.",
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
    description: "Get address/place autocomplete suggestions as the user types. Useful for search boxes.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Partial address or place name to autocomplete" },
        lat: { type: "number", description: "Bias results near this latitude (optional)" },
        lng: { type: "number", description: "Bias results near this longitude (optional)" },
        region: { type: "string", description: "Country code, default IND" },
      },
      required: ["query"],
    },
  },
  {
    name: "text_search",
    description: "Search for places in India by keyword, category, or brand name (e.g. 'Starbucks', 'ATM', 'petrol pump').",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword or place name" },
        region: { type: "string", description: "Country code, default IND" },
        filter: { type: "string", description: "Filter e.g. 'pin:110020' to restrict to a pincode" },
      },
      required: ["query"],
    },
  },
  {
    name: "nearby_search",
    description: "Find points of interest near a location (hospitals, ATMs, restaurants, petrol pumps, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        keywords: { type: "string", description: "Category or keyword (e.g. 'hospital', 'atm', 'restaurant')" },
        lat: { type: "number", description: "Reference latitude" },
        lng: { type: "number", description: "Reference longitude" },
        radius: { type: "number", description: "Search radius in metres (default 1000, max 10000)" },
        sortBy: { type: "string", enum: ["dist:asc", "dist:desc", "imp"], description: "Sort order (default dist:asc)" },
      },
      required: ["keywords", "lat", "lng"],
    },
  },
  {
    name: "place_details",
    description: "Get full details about a specific place using its Mappls eLoc (6-character place code).",
    inputSchema: {
      type: "object",
      properties: {
        eLoc: { type: "string", description: "Mappls eLoc code (e.g. 'MMI000', '17ZUL7')" },
      },
      required: ["eLoc"],
    },
  },
  {
    name: "get_directions",
    description: "Get turn-by-turn driving/biking/walking directions between two points in India.",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Start point as 'lat,lng'" },
        destination: { type: "string", description: "End point as 'lat,lng'" },
        profile: { type: "string", enum: ["driving", "biking", "walking"], description: "Travel mode (default: driving)" },
      },
      required: ["origin", "destination"],
    },
  },
  {
    name: "distance_matrix",
    description: "Calculate distances and travel times between multiple origins and destinations.",
    inputSchema: {
      type: "object",
      properties: {
        coordinates: { type: "string", description: "Semicolon-separated lat,lng points. First point is origin, rest are destinations. E.g. '28.55,77.13;28.48,77.05;28.63,77.21'" },
        profile: { type: "string", enum: ["driving", "biking", "walking"], description: "Travel mode (default: driving)" },
      },
      required: ["coordinates"],
    },
  },
  {
    name: "elevation",
    description: "Get elevation (altitude in metres) for one or more lat/lng points in India.",
    inputSchema: {
      type: "object",
      properties: {
        locations: { type: "string", description: "Pipe-separated lat,lng points e.g. '28.55,77.20|19.07,72.87'" },
      },
      required: ["locations"],
    },
  },
  {
    name: "aerial_distance",
    description: "Get straight-line (aerial/crow-fly) distance between two points.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start point as 'lat,lng'" },
        to: { type: "string", description: "End point as 'lat,lng'" },
        unit: { type: "string", enum: ["K", "M", "N"], description: "Unit: K=kilometres, M=miles, N=nautical miles (default K)" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "poi_along_route",
    description: "Find points of interest along a route (e.g. fuel stations, restaurants on the way from A to B).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Encoded polyline of the route (from get_directions geometry field)" },
        category: { type: "string", description: "POI category to search (e.g. 'FODCOF' for food, 'FINATM' for ATMs)" },
        buffer: { type: "number", description: "Search buffer in metres on each side of route (default 300)" },
      },
      required: ["path", "category"],
    },
  },
  {
    name: "validate_pincode",
    description: "Validate an Indian 6-digit pincode and get its district, city, and state.",
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

    case "get_directions": {
      const origin = toRoutingCoords(String(args.origin));
      const dest = toRoutingCoords(String(args.destination));
      const profile = args.profile ?? "driving";
      return mapplsGet(
        `https://route.mappls.com/route/direction/route_adv/${profile}/${origin};${dest}`,
        { overview: "full", steps: "true" }
      );
    }

    case "distance_matrix": {
      const points = String(args.coordinates).split(";").map((p) => p.trim());
      if (points.length < 2) throw new Error("Provide at least 2 semicolon-separated coordinates");
      const coords = points.map(toRoutingCoords).join(";");
      const profile = args.profile ?? "driving";
      return mapplsGet(
        `https://route.mappls.com/route/dm/distance_matrix/${profile}/${coords}`
      );
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

    case "poi_along_route": {
      const params: Record<string, string> = {
        path: String(args.path),
        category: String(args.category),
        buffer: String(args.buffer ?? 300),
      };
      return mapplsGet("https://search.mappls.com/search/places/along-route", params);
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
  console.error("Mappls MCP server running — 12 tools available");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
