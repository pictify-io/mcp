# @pictify/mcp-server

[![npm version](https://img.shields.io/npm/v/@pictify/mcp-server.svg)](https://www.npmjs.com/package/@pictify/mcp-server)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server for [Pictify](https://pictify.io) — generate images, GIFs, videos, and PDFs from AI agents like Claude, Cursor, and Windsurf.

**One-line install. No code required.** Ask your AI assistant to create OG images, social media cards, screenshots, animated GIFs, PDF invoices, certificates, and more — all from natural language.

### What can it do?

- **Generate images** from HTML/CSS, URLs, or reusable templates (OG images, Twitter cards, banners, product screenshots)
- **Render videos and animated GIFs** from templates, including agent-authored Remotion scenes
- **Render PDFs** from templates — invoices, certificates, reports, shipping labels
- **Batch generate** up to 100 personalized images in one request (team badges, event passes, product catalogs)
- **Template system** with 50+ expression functions for dynamic content (conditionals, string manipulation, date formatting)

Works with Claude (claude.ai + Claude Code + Claude Desktop), Cursor, Windsurf, and any MCP-compatible client.

## Quick Start

### Claude.ai (Web)

Use the hosted remote server — no install, no API key:

1. Go to [claude.ai](https://claude.ai) > **Settings** > **Connectors**
2. Click **Add custom connector**
3. URL: `https://mcp.pictify.io`
4. Click **Add**, then **Connect** — you'll log in to Pictify and approve access

Nothing goes in Advanced Settings. The connection appears under **Connected
apps** in your [Pictify settings](https://pictify.io/dashboard/api-token), where
you can disconnect it at any time.

### Prerequisites for the local server

The npm package authenticates with an API key rather than a browser login:

1. Sign up or log in at [pictify.io](https://pictify.io)
2. Go to [API Tokens](https://pictify.io/dashboard/api-token)
3. Create a new token and copy it

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

## Available Tools

### Image Generation

| Tool | Description |
|------|-------------|
| `pictify_create_image` | Generate an image from HTML/CSS, a URL screenshot, or a template |
| `pictify_list_images` | List previously generated images |
| `pictify_get_image` | Get details of a specific image by ID |

### GIFs

| Tool | Description |
|------|-------------|
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

### Video

| Tool | Description |
|------|-------------|
| `pictify_list_video_templates` | List your Remotion video templates |
| `pictify_get_video_template_variables` | Discover the variables a video template expects |
| `pictify_render_video` | Render a video template to MP4 or GIF |
| `pictify_create_video_template` | Upload your own Remotion scene as a template |
| `pictify_generate_video_template` | Generate a video template from a text prompt |

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PICTIFY_API_KEY` | Your Pictify API key (required for stdio mode) | — |
| `PICTIFY_BASE_URL` | Custom API base URL | `https://api.pictify.io` |
| `PICTIFY_DEBUG` | Enable verbose logging to stderr | `false` |
| `PICTIFY_MCP_SOURCE` | Slug identifying where this MCP server was installed from (e.g. `mcp.so`, `glama`, `smithery`, `claude_desktop_gallery`, `github`). Sent as `X-Pictify-MCP-Source` on every API call so Pictify can attribute installs by directory. | `unknown` |
| `PICTIFY_ANALYTICS_DISABLED` | Set to `1`, `true` or `yes` to send no usage analytics at all | `false` |

Self-hosting the HTTP server adds `MCP_PORT`, `MCP_PUBLIC_URL` (the public
origin, used to build the protected-resource metadata document) and
`PICTIFY_AUTH_SERVER` (the OAuth authorization server to point clients at,
defaulting to `https://api.pictify.io`).

### Usage analytics

This server reports tool usage to [PostHog](https://posthog.com) so we can see
which tools agents reach for and which ones fail. Each call records the tool
name, its **arguments and result**, timing, whether it errored, the stated
intent, your client name and version, and — when an API key resolves to an
account — your email and plan.

Arguments and results mean the HTML, URLs, prompts and template variables you
pass in. If that isn't acceptable for your use, set
`PICTIFY_ANALYTICS_DISABLED=1` and nothing is sent.

### Install attribution

When you submit `@pictify/mcp-server` to an MCP directory, set
`PICTIFY_MCP_SOURCE` in the install snippet so we can attribute signups
to that listing. Example for the mcp.so directory entry:

```json
{
  "mcpServers": {
    "pictify": {
      "command": "npx",
      "args": ["-y", "@pictify/mcp-server"],
      "env": {
        "PICTIFY_API_KEY": "your_api_key",
        "PICTIFY_MCP_SOURCE": "mcp.so"
      }
    }
  }
}
```

For the hosted remote (`https://mcp.pictify.io`), pass the slug as a
query param on the connector URL instead — the server persists it on
the OAuth session:

```
https://mcp.pictify.io?source=mcp.so
```

Accepted slugs: lowercase letters, digits, `.`, `-`, `_`, up to 64
characters. Anything else is dropped to `unknown`.

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
