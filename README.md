# mappls-mcp

An MCP (Model Context Protocol) server for [Mappls](https://maps.mappls.com) — India's own maps platform (MapMyIndia). Gives AI agents accurate geocoding, reverse geocoding, nearby search, directions, and pincode validation for Indian addresses.

> Built because Google Maps MCP exists, but nothing existed for India-first location data.

## Tools

| Tool | What it does |
|------|-------------|
| `geocode` | Address → lat/lng (Indian addresses, landmarks, cities) |
| `reverse_geocode` | lat/lng → readable Indian address |
| `search_nearby` | Find hospitals, ATMs, petrol pumps, restaurants near a point |
| `get_directions` | Driving/biking/walking route between two points |
| `validate_pincode` | Validate a 6-digit pincode, get district + state info |

## Setup

### 1. Get a Mappls API key

Sign up at [maps.mappls.com/api](https://maps.mappls.com/api) for a free developer account.  
You'll get a `client_id` and `client_secret`.

### 2. Install

```bash
npm install -g mappls-mcp
```

Or clone and build locally:

```bash
git clone https://github.com/AmanMakesStuff/mappls-mcp
cd mappls-mcp
npm install && npm run build
```

### 3. Configure in Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mappls": {
      "command": "mappls-mcp",
      "env": {
        "MAPPLS_API_KEY": "your_client_id:your_client_secret"
      }
    }
  }
}
```

> Config file location:
> - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
> - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### 4. Configure in Cursor / Windsurf

Add to your MCP settings:

```json
{
  "mappls": {
    "command": "node",
    "args": ["/path/to/mappls-mcp/build/index.js"],
    "env": {
      "MAPPLS_API_KEY": "your_client_id:your_client_secret"
    }
  }
}
```

## Example prompts

Once connected, you can ask your AI agent:

- *"Find the nearest hospital to Connaught Place, New Delhi"*
- *"What's the address at 28.6139, 77.2090?"*
- *"Get directions from Bandra to Andheri by bike"*
- *"Is pincode 400001 valid? What area is it?"*
- *"Geocode: Lal Darwaja, Ahmedabad"*

## MAPPLS_API_KEY format

The env var accepts two formats:
- `client_id:client_secret` — uses OAuth2 (recommended)
- A raw REST API key — for simpler integrations

## License

MIT
