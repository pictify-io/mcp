# @pictify/mcp-server

[![npm version](https://img.shields.io/npm/v/@pictify/mcp-server.svg)](https://www.npmjs.com/package/@pictify/mcp-server)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server for [Pictify](https://pictify.io) — generate images, GIFs, and PDFs from AI agents like Claude, Cursor, and Windsurf.

**One-line install. No code required.** Ask your AI assistant to create OG images, social media cards, screenshots, animated GIFs, PDF invoices, certificates, and more — all from natural language.

### What can it do?

- **Generate images** from HTML/CSS, URLs, or reusable templates (OG images, Twitter cards, banners, product screenshots)
- **Create animated GIFs** from CSS animations or by recording live web pages
- **Render PDFs** from templates — invoices, certificates, reports, shipping labels
- **Batch generate** up to 100 personalized images in one request (team badges, event passes, product catalogs)
- **A/B test images** with built-in experiments, traffic splitting, and auto-optimization
- **Template system** with 50+ expression functions for dynamic content (conditionals, string manipulation, date formatting)

Works with Claude (claude.ai + Claude Code + Claude Desktop), Cursor, Windsurf, and any MCP-compatible client.

## Quick Start

### Prerequisites

Get your API key:

1. Sign up or log in at [pictify.io](https://pictify.io)
2. Go to [API Tokens](https://pictify.io/dashboard/api-tokens)
3. Create a new token and copy it

### Claude.ai (Web)

Use the hosted remote server — no install needed:

1. Go to [claude.ai](https://claude.ai) > **Settings** > **Connectors**
2. Click **Add custom connector**
3. URL: `https://mcp.pictify.io`
4. Click **Advanced Settings**
5. **Client ID**: `pictify`
6. **Client Secret**: paste your API token
7. Click **Add**

### Claude Code

```bash
claude mcp add pictify -e PICTIFY_API_KEY=your_api_key -- npx -y @pictify/mcp-server
```

### Claude Desktop

Add to your config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pictify": {
      "command": "npx",
      "args": ["-y", "@pictify/mcp-server"],
      "env": {
        "PICTIFY_API_KEY": "your_api_key"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Cursor

Add to Cursor's MCP settings (Settings > MCP Servers):

```json
{
  "mcpServers": {
    "pictify": {
      "command": "npx",
      "args": ["-y", "@pictify/mcp-server"],
      "env": {
        "PICTIFY_API_KEY": "your_api_key"
      }
    }
  }
}
```

### Windsurf

Add to Windsurf's MCP settings:

```json
{
  "mcpServers": {
    "pictify": {
      "command": "npx",
      "args": ["-y", "@pictify/mcp-server"],
      "env": {
        "PICTIFY_API_KEY": "your_api_key"
      }
    }
  }
}
```

## Examples

Try these prompts after connecting:

**Create a social media card:**
> "Create a Twitter card image for my blog post titled 'Getting Started with MCP' with a blue gradient background, 1200x630."

**Screenshot a website:**
> "Take a screenshot of stripe.com at 1440x900."

**Render a template:**
> "List my templates and render the blog-header template with title 'Hello World'."

**Batch generate images:**
> "Use my team-badge template to generate images for these 10 team members: ..."

**Create a PDF invoice:**
> "Render my invoice template as a PDF with company name 'Acme Inc', amount '$1,500', and date 'March 2026'."

**A/B test an image:**
> "Create an A/B test experiment with two variants of my hero banner and start routing traffic."

## Available Tools

### Image Generation

| Tool | Description |
|------|-------------|
| `pictify_create_image` | Generate an image from HTML/CSS, a URL screenshot, or a template |
| `pictify_create_canvas_image` | Generate an image from FabricJS canvas JSON data |
| `pictify_list_images` | List previously generated images |
| `pictify_get_image` | Get details of a specific image by ID |

### GIF Creation

| Tool | Description |
|------|-------------|
| `pictify_create_gif` | Create animated GIF from HTML with CSS animations |
| `pictify_capture_gif` | Record a GIF from a live web page over time |
| `pictify_list_gifs` | List previously generated GIFs |
| `pictify_get_gif` | Get details of a specific GIF by ID |

### PDF Generation

| Tool | Description |
|------|-------------|
| `pictify_render_pdf` | Generate single-page PDF from a template |
| `pictify_render_multi_page_pdf` | Generate multi-page PDF from a template |
| `pictify_list_pdf_presets` | List available PDF page size presets |

### Template Management

| Tool | Description |
|------|-------------|
| `pictify_list_templates` | List saved templates with filtering and pagination |
| `pictify_get_template` | Get template details |
| `pictify_get_template_variables` | Get template variable definitions and types |
| `pictify_render_template` | Render a template with variables (supports layout variants) |
| `pictify_create_template` | Create a new template (HTML or FabricJS) |
| `pictify_update_template` | Update an existing template |
| `pictify_delete_template` | Delete a template |

### Batch Operations

| Tool | Description |
|------|-------------|
| `pictify_batch_render` | Start batch render job (up to 100 items, async) |
| `pictify_get_batch_results` | Check batch job status and get result URLs |
| `pictify_cancel_batch` | Cancel a running batch job |

### A/B Testing & Experiments

| Tool | Description |
|------|-------------|
| `pictify_list_experiments` | List experiments (A/B tests, smart links, scheduled) |
| `pictify_create_experiment` | Create an experiment with variants and traffic weights |
| `pictify_get_experiment` | Get experiment details and per-variant performance |
| `pictify_get_experiment_quota` | Check experiment usage and plan limits |
| `pictify_update_experiment` | Update experiment config (field access depends on status) |
| `pictify_delete_experiment` | Delete an experiment |
| `pictify_start_experiment` | Start routing traffic to variants |
| `pictify_pause_experiment` | Pause traffic routing (data preserved) |
| `pictify_complete_experiment` | Declare a winner and route all traffic to it |
| `pictify_track_experiment_events` | Track impressions, clicks, and conversions |

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PICTIFY_API_KEY` | Your Pictify API key (required for stdio mode) | — |
| `PICTIFY_BASE_URL` | Custom API base URL | `https://api.pictify.io` |
| `PICTIFY_DEBUG` | Enable verbose logging to stderr | `false` |

## Development

```bash
git clone https://github.com/pictify-io/pictify-mcp.git
cd pictify-mcp
npm install
npm run build
```

Test with MCP Inspector:

```bash
PICTIFY_API_KEY=your_key npm run inspector
```

## License

MIT
