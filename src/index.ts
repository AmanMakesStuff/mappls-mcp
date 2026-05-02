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
const BASE_URL = "https://atlas.mappls.com/api";
const TOKEN_URL = "https://outpost.mappls.com/api/security/oauth/token";

if (!API_KEY) {
  console.error("Error: MAPPLS_API_KEY environment variable is required");
  process.exit(1);
}

// Mappls uses OAuth2 client credentials. API_KEY here is "client_id:client_secret"
// Users can pass either just a REST key or client_id:client_secret
let accessToken: string | null = null;
let tokenExpiry = 0;

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  const [clientId, clientSecret] = API_KEY!.split(":");
  if (!clientSecret) {
    // Fallback: treat as a direct REST API key
    return API_KEY!;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
  });

  if (!res.ok) throw new Error(`Token fetch failed: ${res.statusText}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken;
}

async function mapplsGet(path: string, params: Record<string, string>) {
  const token = await getAccessToken();
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Mappls API error ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── Tool schemas ────────────────────────────────────────────────────────────

const GeocodeInput = z.object({
  address: z.string().describe("Full address to geocode (e.g. 'Connaught Place, New Delhi')"),
  region: z.string().optional().describe("Region bias, e.g. 'IND' for India"),
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
});

const GetDirectionsInput = z.object({
  origin: z.string().describe("Origin as 'lat,lng' or a full address"),
  destination: z.string().describe("Destination as 'lat,lng' or a full address"),
  profile: z
    .enum(["driving", "biking", "walking"])
    .optional()
    .default("driving")
    .describe("Travel mode"),
});

const ValidatePincodeInput = z.object({
  pincode: z.string().describe("6-digit Indian pincode"),
});

// ── Handlers ────────────────────────────────────────────────────────────────

async function geocode(input: z.infer<typeof GeocodeInput>) {
  const params: Record<string, string> = { address: input.address };
  if (input.region) params.region = input.region;
  const data = await mapplsGet("/places/geocode", params);
  return data;
}

async function reverseGeocode(input: z.infer<typeof ReverseGeocodeInput>) {
  const data = await mapplsGet("/places/reverse_geocode", {
    lat: String(input.lat),
    lng: String(input.lng),
  });
  return data;
}

async function searchNearby(input: z.infer<typeof SearchNearbyInput>) {
  const data = await mapplsGet("/places/nearby/json", {
    keywords: input.keywords,
    refLocation: `${input.lat},${input.lng}`,
    radius: String(input.radius),
  });
  return data;
}

async function getDirections(input: z.infer<typeof GetDirectionsInput>) {
  // If origin/destination look like addresses, geocode them first
  const resolvePoint = async (point: string): Promise<string> => {
    if (/^-?\d+\.?\d*,-?\d+\.?\d*$/.test(point)) return point;
    const geo = (await geocode({ address: point })) as any;
    const loc = geo?.copResults?.latitude
      ? `${geo.copResults.latitude},${geo.copResults.longitude}`
      : null;
    if (!loc) throw new Error(`Could not geocode: ${point}`);
    return loc;
  };

  const [originCoords, destCoords] = await Promise.all([
    resolvePoint(input.origin),
    resolvePoint(input.destination),
  ]);

  const data = await mapplsGet(
    `/directions/v1/${input.profile}/${originCoords};${destCoords}`,
    { overview: "full", steps: "true" }
  );
  return data;
}

async function validatePincode(input: z.infer<typeof ValidatePincodeInput>) {
  if (!/^\d{6}$/.test(input.pincode)) {
    return { valid: false, error: "Pincode must be exactly 6 digits" };
  }
  const data = await mapplsGet("/places/pincode/json", { pincode: input.pincode });
  return data;
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
          region: { type: "string", description: "Region bias, default 'IND'" },
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
        },
        required: ["keywords", "lat", "lng"],
      },
    },
    {
      name: "get_directions",
      description:
        "Get driving/biking/walking directions between two points in India, including distance and step-by-step route.",
      inputSchema: {
        type: "object",
        properties: {
          origin: {
            type: "string",
            description: "Start point as 'lat,lng' or a full address",
          },
          destination: {
            type: "string",
            description: "End point as 'lat,lng' or a full address",
          },
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
