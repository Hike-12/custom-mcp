import fs from "fs/promises";
import path from "path";
import MiniSearch from "minisearch";
import { exec } from "child_process";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

/*
  CONFIG
*/
const SKILLS_DIR =
  "C:/Users/Lenovo/Desktop/Aliqyaan Coding/SKILLS MCP";

const GROQ_API_KEY = "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"; // replace
console.error("Starting...");
/*
  MINISEARCH
*/
const miniSearch = new MiniSearch({
  fields: ["name", "content"],
  storeFields: ["name", "path", "snippet"],
  searchOptions: {
    boost: { name: 3 },
    fuzzy: 0.2,
    prefix: true
  }
});

/*
  RECURSIVE FILE SCAN
*/
async function getAllSkillFiles(dir) {
  let results = [];
  const list = await fs.readdir(dir);

  for (const file of list) {
    const full = path.join(dir, file);
    const stat = await fs.stat(full);

    if (stat.isDirectory()) {
      if (file !== "node_modules" && file !== ".git") {
        results = results.concat(await getAllSkillFiles(full));
      }
    } else if (file.toLowerCase() === "skill.md") {
      results.push(full);
    }
  }

  return results;
}

/*
  LOAD SKILLS
*/
async function initSkills() {
  const files = await getAllSkillFiles(SKILLS_DIR);

  const docs = [];

  for (let i = 0; i < files.length; i++) {
    const fullPath = files[i];
    const content = await fs.readFile(fullPath, "utf-8");

    const relative = path.relative(SKILLS_DIR, fullPath);
    const name = relative.replace(/\\/g, "/").replace("/skill.md", "");

    const indexedContent = content.slice(0, 3000);

    const clean = indexedContent.replace(/```[\s\S]*?```/g, "[CODE]");
    const snippet =
      clean.slice(0, 180).replace(/\n/g, " ") + "...";

    docs.push({
      id: i,
      name,
      path: fullPath,
      content: indexedContent,
      snippet
    });
  }

  miniSearch.addAll(docs);
  console.error(`Loaded ${docs.length} skills`);
}

/*
  SEARCH
*/
function searchSkills(query) {
  return miniSearch.search(query).slice(0, 5);
}

/*
  GROQ CALL (FETCH VERSION)
*/
async function callLlama(prompt) {
  const res = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0
      })
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq API error: ${text}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function getProjectContext() {
  try {
    const files = await fs.readdir(process.cwd());
    let context = [];
    if (files.includes("package.json")) {
      context.push("Node.js/JavaScript/TypeScript ecosystem");
      const pkg = JSON.parse(await fs.readFile(path.join(process.cwd(), "package.json"), "utf8"));
      if (pkg.dependencies) {
        if (pkg.dependencies.react) context.push("React");
        if (pkg.dependencies.express) context.push("Express/MERN");
        if (pkg.dependencies.next) context.push("Next.js");
      }
    }
    if (files.includes("pubspec.yaml")) context.push("Flutter/Dart");
    if (files.includes("requirements.txt") || files.includes("pyproject.toml")) context.push("Python");
    if (files.includes("pom.xml") || files.includes("build.gradle")) context.push("Java");

    return context.length > 0 ? context.join(", ") : "Unknown tech stack";
  } catch (err) {
    return "Unknown tech stack";
  }
}

/*
  INTENT EXTRACTION
*/
async function getIntents(query, projectContext) {
  const prompt = `
You are analyzing a request for a software project. 
The project has been automatically detected to use this tech stack: ${projectContext}

Break the user's query into clear engineering tasks. 
VERY IMPORTANT: explicitly inject the detected technologies into the intent descriptions so that a search engine will find language-specific skills (e.g., use "Set up Express database" instead of just "Set up database", or "Build React UI" instead of "Build UI", avoid Flutter if it's MERN).

Return ONLY a JSON array of plain strings. Do not use objects.
Example for a Node project: ["Set up Node Express server", "Build React UI"]

Query:
${query}
`;

  const res = await callLlama(prompt);

  try {
    return JSON.parse(res);
  } catch {
    return [query];
  }
}

/*
  PLAN GENERATION
*/
async function planExecution(query, skills) {
  const prompt = `
You are a system planner.

Given user query and available skills, create ordered steps.

Query:
${query}

Skills:
${JSON.stringify(skills)}

Return JSON:
[
 { "step": 1, "skill": "name" }
]
`;

  const res = await callLlama(prompt);

  try {
    return JSON.parse(res);
  } catch {
    return [];
  }
}

/*
  MCP SERVER
*/
const server = new Server(
  { name: "custom-mcp", version: "1.0.0" }, 
  { capabilities: { tools: {} } }
);
/*
  TOOLS
*/
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "auto_engineer",
        description: "intent → search → plan",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" }
          },
          required: ["query"]
        }
      },
      {
        name: "get_skill",
        description: "fetch full skill",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" }
          },
          required: ["path"]
        }
      }
    ]
  };
});

/*
  EXECUTION
*/
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === "auto_engineer") {
    const query = args.query;

    const projectContext = await getProjectContext();
    const intents = await getIntents(query, projectContext);

    let allSkills = [];

    for (let intent of intents) {
      if (typeof intent !== "string") {
        intent = Object.values(intent).join(" ") || JSON.stringify(intent);
      }

      const results = searchSkills(intent);
      allSkills.push(...results);
    }

    const unique = Array.from(
      new Map(allSkills.map(s => [s.id, s])).values()
    );

    const plan = await planExecution(query, unique);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              intents,
              skills: unique,
              plan
            },
            null,
            2
          )
        }
      ]
    };
  }

  if (name === "get_skill") {
    const content = await fs.readFile(args.path, "utf-8");

    return {
      content: [{ type: "text", text: content }]
    };
  }

  throw new Error("Unknown tool");
});

/*
  START
*/
async function start() {
  await initSkills();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

start();