# Custom MCP

An MCP (Model Context Protocol) server that uses local skill files and Groq LLM to plan and execute engineering tasks.

## Setup

```bash
npm install
```

## Configuration

Copy `.env` (already provided) with these variables:

```
GROQ_API_KEY=your_groq_api_key
SKILLS_DIR=path/to/your/skills/directory
```

The `SKILLS_DIR` should point to a folder containing `skill.md` files organized in subdirectories.

## Usage

This MCP server exposes two tools:

- **`auto_engineer`** — Takes a query, breaks it into intents, searches relevant skills, and generates an execution plan using Groq's Llama 3.1.
- **`get_skill`** — Fetches the full content of a skill by its file path.

Run with:

```bash
node server.js
```

The server communicates over stdio (standard MCP transport).
