# mappls-mcp

An MCP (Model Context Protocol) server for [Mappls](https://maps.mappls.com) — India's own maps platform (MapMyIndia). Gives AI agents accurate geocoding, routing, nearby search, and more for Indian addresses and locations.

> Built because Google Maps MCP exists, but nothing existed for India-first location data.

## Tools (18)

### Search & Geocoding
| Tool | Description |
|------|-------------|
| `geocode` | Address or place name → lat/lng |
| `reverse_geocode` | lat/lng → human-readable Indian address |
| `autosuggest` | Autocomplete suggestions as user types |
| `text_search` | Search by keyword or brand (e.g. "Starbucks Delhi") |
| `nearby_search` | Find hospitals, ATMs, petrol pumps, restaurants near a point |
| `place_details` | Full details for a place using its eLoc code |
| `address_analytics` | Standardize a raw address into structured components |
| `validate_pincode` | Validate a 6-digit pincode, get district + state |

### Routing & Navigation
| Tool | Description |
|------|-------------|
| `get_directions` | Turn-by-turn directions (driving/biking/walking) |
| `get_directions_with_traffic` | Traffic-aware ETA using real-time conditions |
| `distance_matrix` | Distances + durations between multiple points |
| `distance_matrix_with_traffic` | Traffic-aware distance matrix |
| `poi_along_route` | Find fuel stations, restaurants, ATMs along a route |
| `snap_to_road` | Snap raw GPS coordinates to nearest road |

### Utilities
| Tool | Description |
|------|-------------|
| `elevation` | Altitude above sea level for any lat/lng point |
| `aerial_distance` | Straight-line (crow-fly) distance between two points |
| `still_map_image` | Generate a static map image URL for any location |

## Getting Started

### 1. Get a Mappls API key

1. Sign up at [maps.mappls.com/api](https://maps.mappls.com/api)
2. Create a new **Cloud** project
3. Go to **Credentials** tab — copy the **Static Key**
4. Go to **Whitelisting** tab — leave IP field blank for unrestricted access (or add your server IP for production)

### 2. Install

```bash
npm install -g mappls-mcp
```

Or run directly without installing:

```bash
npx mappls-mcp
```

Or clone and build locally:

```bash
git clone https://github.com/AmanMakesStuff/mappls-mcp
cd mappls-mcp
npm install && npm run build
```

### 3. Configure

Set your API key as an environment variable:

```bash
export MAPPLS_API_KEY=your_static_key_here
```

---

## Integration

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "mappls": {
      "command": "npx",
      "args": ["mappls-mcp"],
      "env": {
        "MAPPLS_API_KEY": "your_static_key_here"
      }
    }
  }
}
```

### Cursor / Windsurf

Add to your MCP settings:

```json
{
  "mappls": {
    "command": "npx",
    "args": ["mappls-mcp"],
    "env": {
      "MAPPLS_API_KEY": "your_static_key_here"
    }
  }
}
```

### Local build (alternative)

If you cloned the repo:

```json
{
  "mcpServers": {
    "mappls": {
      "command": "node",
      "args": ["/absolute/path/to/mappls-mcp/build/index.js"],
      "env": {
        "MAPPLS_API_KEY": "your_static_key_here"
      }
    }
  }
}
```

---

## Example Prompts

Once connected, ask your AI agent:

- *"Find the nearest hospital to Connaught Place, New Delhi"*
- *"What's the address at 28.6139, 77.2090?"*
- *"Get driving directions from Bandra to Andheri"*
- *"Is pincode 400001 valid? What area is it?"*
- *"How far is Delhi from Mumbai in a straight line?"*
- *"What is the elevation of Shimla?"*
- *"Find ATMs along the route from India Gate to Qutub Minar"*
- *"Standardize this address: 237 Okhla Industrial Phase 3 ND 110020"*
- *"Search for Domino's near Koramangala Bangalore"*

---

## Notes

- All tools accept **lat/lng in decimal degrees** (e.g. `28.6139, 77.2090`)
- Routing tools use **lat,lng format** for input (the server handles coordinate conversion internally)
- `nearby_search` uses plain keywords like `"hospital"`, `"atm"`, `"restaurant"` — Mappls maps these to category codes automatically
- `poi_along_route` requires the encoded polyline from the `geometry` field of a `get_directions` response
- `still_map_image` returns a URL — the image is a PNG map tile

## License

MIT — built by [AmanMakesStuff](https://github.com/AmanMakesStuff)
