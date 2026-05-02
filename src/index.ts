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

async function mapplsGet(baseUrl: string, params: Record<string, string>) {
  const url = new URL(baseUrl);
  url.searchParams.set("access_token", API_KEY!);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (res.status === 204) return { results: [], message: "No results found" };
  if (!res.ok) throw new Error(`Mappls API error ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── Tool schemas ─────────────────────────────────────────────────────────────

const GeocodeInput = z.object({
  address: z.string().describe("Full address to geocode (e.g. 'Connaught Place, New Delhi')"),
  itemCount: z.number().optional().default(5).describe("Max results to return (default 5)"),
});

const ReverseGeocodeInput = z.object({
  lat: z.number().describe("Latitude"),
  lng: z.number().describe("Longitude"),
});

const SearchNearbyInput = z.object({
  keywords: z.string().describe("Category or keyword (e.g. 'hospital', 'ATM', 'restaurant')"),
  lat: z.number().describe("Reference latitude"),
  lng: z.number().describe("Reference longitude"),
  radius: z.number().optional().default(1000).describe("Search radius in metres (default 1000)"),
  itemCount: z.number().optional().default(10).describe("Max results (default 10)"),
});

const GetDirectionsInput = z.object({
  origin: z.string().describe("Start point as 'lat,lng'"),
  destination: z.string().describe("End point as 'lat,lng'"),
  profile: z
    .enum(["driving", "biking", "walking"])
    .optional()
    .default("driving")
    .describe("Travel mode (default: driving)"),
});

const ValidatePincodeInput = z.object({
  pincode: z.string().describe("6-digit Indian pincode"),
});

// ── Handlers ─────────────────────────────────────────────────────────────────

async function geocode(input: z.infer<typeof GeocodeInput>) {
  return mapplsGet("https://search.mappls.com/search/address/geocode", {
    address: input.address,
    itemCount: String(input.itemCount),
  });
}

async function reverseGeocode(input: z.infer<typeof ReverseGeocodeInput>) {
  return mapplsGet("https://search.mappls.com/search/address/rev-geocode", {
    lat: String(input.lat),
    lng: String(input.lng),
  });
}

async function searchNearby(input: z.infer<typeof SearchNearbyInput>) {
  return mapplsGet("https://search.mappls.com/search/places/nearby/json", {
    keywords: input.keywords,
    refLocation: `${input.lat},${input.lng}`,
    radius: String(input.radius),
    itemCount: String(input.itemCount),
  });
}

async function getDirections(input: z.infer<typeof GetDirectionsInput>) {
  // Route API uses lng,lat order (not lat,lng)
  // Accepts "lat,lng" input but converts to "lng,lat" for the API
  const toApiCoords = (point: string) => {
    const [lat, lng] = point.split(",").map((s) => s.trim());
    return `${lng},${lat}`;
  };
  const origin = toApiCoords(input.origin);
  const dest = toApiCoords(input.destination);
  return mapplsGet(
    `https://route.mappls.com/route/direction/route_adv/${input.profile}/${origin};${dest}`,
    { overview: "full", steps: "true" }
  );
}

async function validatePincode(input: z.infer<typeof ValidatePincodeInput>) {
  if (!/^\d{6}$/.test(input.pincode)) {
    return { valid: false, error: "Pincode must be exactly 6 digits" };
  }
  // Geocode API accepts pincode directly and returns district/state info
  return mapplsGet("https://search.mappls.com/search/address/geocode", {
    address: input.pincode,
  });
}

// ── MCP server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "mappls-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "geocode",
      description:
        "Convert an Indian address or place name into latitude/longitude coordinates using Mappls.",
      inputSchema: {
        type: "object",
        properties: {
          address: { type: "string", description: "Full address (e.g. 'India Gate, New Delhi')" },
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
      name: "search_nearby",
      description:
        "Find points of interest near a location in India (hospitals, ATMs, restaurants, petrol pumps, etc.)",
      inputSchema: {
        type: "object",
        properties: {
          keywords: { type: "string", description: "Category or keyword, e.g. 'hospital'" },
          lat: { type: "number", description: "Reference latitude" },
          lng: { type: "number", description: "Reference longitude" },
          radius: { type: "number", description: "Search radius in metres (default 1000)" },
          itemCount: { type: "number", description: "Max results (default 10)" },
        },
        required: ["keywords", "lat", "lng"],
      },
    },
    {
      name: "get_directions",
      description:
        "Get driving/biking/walking directions between two lat,lng points in India, including distance and step-by-step route.",
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
      name: "validate_pincode",
      description:
        "Validate an Indian 6-digit pincode and retrieve the associated district, state, and post office details.",
      inputSchema: {
        type: "object",
        properties: {
          pincode: { type: "string", description: "6-digit Indian pincode" },
        },
        required: ["pincode"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    if (name === "geocode") {
      result = await geocode(GeocodeInput.parse(args));
    } else if (name === "reverse_geocode") {
      result = await reverseGeocode(ReverseGeocodeInput.parse(args));
    } else if (name === "search_nearby") {
      result = await searchNearby(SearchNearbyInput.parse(args));
    } else if (name === "get_directions") {
      result = await getDirections(GetDirectionsInput.parse(args));
    } else if (name === "validate_pincode") {
      result = await validatePincode(ValidatePincodeInput.parse(args));
    } else {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Mappls MCP server running");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
