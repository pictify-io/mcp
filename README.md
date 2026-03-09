# @pictify/mcp-server

Generate images, GIFs, and PDFs with AI agents using [Pictify](https://pictify.io).

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that wraps the Pictify API, enabling AI assistants to create visual content programmatically.

## Installation

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "pictify": {
      "command": "npx",
      "args": ["-y", "@pictify/mcp-server"],
      "env": {
        "PICTIFY_API_KEY": "pk_live_your_api_key"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Claude Code

```bash
claude mcp add pictify -- npx -y @pictify/mcp-server
```

Set your API key:

```bash
export PICTIFY_API_KEY=pk_live_your_api_key
```

### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "pictify": {
      "command": "npx",
      "args": ["-y", "@pictify/mcp-server"],
      "env": {
        "PICTIFY_API_KEY": "pk_live_your_api_key"
      }
    }
  }
}
```

## Available Tools

### Image Generation

| Tool | Description |
|------|-------------|
| `pictify_create_image` | Generate an image from HTML/CSS content |
| `pictify_screenshot` | Capture a screenshot of a web page |
| `pictify_list_images` | List previously generated images |

### GIF Creation

| Tool | Description |
|------|-------------|
| `pictify_create_gif` | Create animated GIF from HTML with CSS animations |
| `pictify_capture_gif` | Capture GIF from a live web page |
| `pictify_list_gifs` | List previously generated GIFs |

### PDF Generation

| Tool | Description |
|------|-------------|
| `pictify_render_pdf` | Generate single-page PDF from template |
| `pictify_render_multi_page_pdf` | Generate multi-page PDF from template |
| `pictify_list_pdf_presets` | List available PDF size presets |

### Template Management

| Tool | Description |
|------|-------------|
| `pictify_list_templates` | List saved templates |
| `pictify_get_template` | Get template details |
| `pictify_get_template_variables` | Get template variable definitions |
| `pictify_render_template` | Render template with variables |
| `pictify_create_template` | Create a new template |
| `pictify_update_template` | Update an existing template |
| `pictify_delete_template` | Delete a template |

### Batch Operations

| Tool | Description |
|------|-------------|
| `pictify_batch_render` | Start batch render job (up to 100 items) |
| `pictify_get_batch_results` | Check batch job status and results |
| `pictify_cancel_batch` | Cancel a running batch job |

### Experiments

| Tool | Description |
|------|-------------|
| `pictify_list_experiments` | List A/B test experiments |
| `pictify_create_experiment` | Create a new experiment |
| `pictify_get_experiment` | Get experiment details |
| `pictify_update_experiment` | Update an experiment |
| `pictify_delete_experiment` | Delete an experiment |
| `pictify_start_experiment` | Start a draft/paused experiment |
| `pictify_pause_experiment` | Pause a running experiment |
| `pictify_complete_experiment` | Complete experiment with winner |

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PICTIFY_API_KEY` | Your Pictify API key (required) | — |
| `PICTIFY_BASE_URL` | Custom API base URL | `https://api.pictify.io` |
| `PICTIFY_DEBUG` | Enable verbose logging to stderr | `false` |

Get your API key at [pictify.io/dashboard](https://pictify.io/dashboard).

## Examples

**Create a social media card:**
> "Create a Twitter card image for my blog post titled 'Getting Started with MCP' with a blue gradient background, 1200x630."

**Screenshot a website:**
> "Take a screenshot of stripe.com at 1440x900."

**Render a template:**
> "List my templates and render the blog-header template with title 'Hello World'."

**Batch generate images:**
> "Use my invoice template to generate PDFs for these 5 customers: ..."

## Development

```bash
git clone https://github.com/pictify-io/pictify-mcp.git
cd pictify-mcp
npm install
npm run build
```

Test with MCP Inspector:

```bash
PICTIFY_API_KEY=pk_test_... npm run inspector
```

## License

MIT
