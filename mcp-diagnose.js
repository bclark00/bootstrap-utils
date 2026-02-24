#!/usr/bin/env node
/**
 * MCP Server Diagnostics
 * Run from Windows: node mcp-diagnose.js
 * Spawns each server, sends initialize + tools/list, shows exactly what
 * breaks and why (Zod errors = bad schema, missing fields, etc.)
 */

const { spawn } = require("child_process");
const path = require("path");

const SERVERS = [
  {
    name: "prime-velocity-omnipotence",
    cmd: "node",
    args: ["C:\\Users\\sethi\\.claude-mcp-servers\\prime-velocity-omnipotence-stdio-fix.js"],
  },
  {
    name: "mtransport-v5-streaming",
    cmd: "node",
    args: ["C:\\Users\\sethi\\mtransport-v5-cascade\\mcp-streaming-server.js"],
  },
  {
    name: "tool-cdn",
    cmd: "node",
    args: ["C:\\Users\\sethi\\tool-cdn\\exeray-mcp-server.js"],
  },
  {
    name: "pattern-registry",
    cmd: "node",
    args: ["C:\\Users\\sethi\\GitHub-Repos\\exponential-systems\\orchestration\\patterns-mcp-server.cjs"],
  },
  {
    name: "scout",
    cmd: "node",
    args: ["C:\\Genesis\\scout\\scout-cdn-wrapper.js"],
    env: {
      SCOUT_DB_PATH: "C:\\Genesis\\scout\\scout\\db\\scout.db",
      SCOUT_BACKUP_DIR: "C:\\Genesis\\scout\\scout\\.scout-backup",
    },
  },
  {
    name: "vault",
    cmd: "node",
    args: ["C:\\Users\\sethi\\vault-mcp\\vault-mcp.js"],
  },
  {
    name: "genesis-health",
    cmd: "node",
    args: ["C:\\Users\\sethi\\genesis-health\\genesis-health.js"],
  },
  {
    name: "audit-nexus",
    cmd: "node",
    args: ["C:\\Users\\sethi\\audit-nexus\\mcp-server.js"],
  },
  {
    name: "conduit",
    cmd: "node",
    args: ["C:\\Users\\sethi\\conduit\\conduit-mcp-server.js"],
  },
  {
    name: "illuminaughty",
    cmd: "node",
    args: ["C:\\Users\\sethi\\EverythingMCP-Deploy\\illuminaughty-mcp-server.js"],
  },
  {
    name: "exponential-system",
    cmd: "node",
    args: ["C:\\Users\\sethi\\IntegratedExponentialSystem\\exponential-mcp-unified.js"],
  },
  {
    name: "infrastructure",
    cmd: "python",
    args: ["-m", "infrastructure_mcp_server"],
    cwd: "C:\\Users\\sethi\\infrastructure-mcp",
  },
  {
    name: "websocket-bridge",
    cmd: "node",
    args: ["C:\\Users\\sethi\\mcp-websocket-bridge\\src\\bridge-fixed.js"],
  },
  {
    name: "windows-files",
    cmd: "node",
    args: ["C:\\Users\\sethi\\windows-file-mcp-server.js"],
  },
];

const SEP = "─".repeat(60);

function testServer(server) {
  return new Promise((resolve) => {
    const result = {
      name: server.name,
      status: "UNKNOWN",
      issues: [],
      tools: [],
      raw: {},
    };

    const file = server.args[0];
    const fs = require("fs");

    // Check if file exists first
    if (server.cmd === "node" && !fs.existsSync(file)) {
      result.status = "MISSING";
      result.issues.push(`File not found: ${file}`);
      return resolve(result);
    }

    const env = { ...process.env, ...(server.env || {}) };
    let proc;
    try {
      proc = spawn(server.cmd, server.args, {
        cwd: server.cwd || undefined,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      result.status = "SPAWN_FAIL";
      result.issues.push(`Spawn failed: ${e.message}`);
      return resolve(result);
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const done = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (proc && !proc.killed) proc.kill();
      result.status = status;
      resolve(result);
    };

    const timer = setTimeout(() => {
      result.issues.push("TIMEOUT: No response in 5s");
      done("TIMEOUT");
    }, 5000);

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
      // Try to parse each newline-delimited JSON
      const lines = stdout.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          // Check initialize response
          if (msg.result && msg.result.protocolVersion !== undefined) {
            result.raw.initialize = msg.result;
            // Validate required fields
            if (!msg.result.protocolVersion) result.issues.push("initialize: missing protocolVersion");
            if (!msg.result.capabilities) result.issues.push("initialize: missing capabilities");
            if (!msg.result.serverInfo) result.issues.push("initialize: missing serverInfo");

            // Send tools/list
            proc.stdin.write(
              JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n"
            );
          }
          // Check tools/list response
          if (msg.id === 2 && msg.result) {
            result.raw.toolsList = msg.result;
            const tools = msg.result.tools || [];
            result.tools = tools.map((t) => t.name);
            // Validate tool schemas - this is what causes Zod errors
            for (const tool of tools) {
              if (!tool.name) result.issues.push(`Tool missing name: ${JSON.stringify(tool)}`);
              if (!tool.description) result.issues.push(`Tool "${tool.name}": missing description`);
              if (!tool.inputSchema) {
                result.issues.push(`Tool "${tool.name}": missing inputSchema (CAUSES ZOD ERROR)`);
              } else {
                if (tool.inputSchema.type !== "object") {
                  result.issues.push(
                    `Tool "${tool.name}": inputSchema.type="${tool.inputSchema.type}" must be "object" (CAUSES ZOD ERROR)`
                  );
                }
                if (!tool.inputSchema.properties) {
                  result.issues.push(
                    `Tool "${tool.name}": inputSchema missing properties (CAUSES ZOD ERROR)`
                  );
                }
              }
            }
            done(result.issues.length === 0 ? "OK" : "SCHEMA_ERRORS");
          }
          // Error response
          if (msg.error) {
            result.issues.push(`JSON-RPC error: ${msg.error.message}`);
            done("PROTOCOL_ERROR");
          }
        } catch (_) {
          // Not JSON yet, keep buffering
        }
      }
    });

    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("error", (e) => {
      result.issues.push(`Process error: ${e.message}`);
      done("PROC_ERROR");
    });

    proc.on("exit", (code) => {
      if (!settled) {
        result.issues.push(`Process exited early with code ${code}`);
        if (stderr) result.issues.push(`stderr: ${stderr.slice(0, 500)}`);
        done("EXIT_EARLY");
      }
    });

    // Send initialize
    proc.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mcp-diagnose", version: "1.0" },
        },
      }) + "\n"
    );
  });
}

async function main() {
  console.log(`\nMCP Server Diagnostics`);
  console.log(`${SEP}\n`);

  const results = [];
  for (const server of SERVERS) {
    process.stdout.write(`Testing ${server.name}... `);
    const result = await testServer(server);
    results.push(result);
    console.log(result.status);
  }

  console.log(`\n${SEP}`);
  console.log(`SUMMARY`);
  console.log(SEP);

  const ok = results.filter((r) => r.status === "OK");
  const bad = results.filter((r) => r.status !== "OK");

  console.log(`\nPASSING (${ok.length}):`);
  for (const r of ok) {
    console.log(`  [OK]  ${r.name}  (${r.tools.length} tools: ${r.tools.join(", ")})`);
  }

  console.log(`\nFAILING (${bad.length}):`);
  for (const r of bad) {
    console.log(`\n  [${r.status}]  ${r.name}`);
    for (const issue of r.issues) {
      console.log(`    - ${issue}`);
    }
    if (r.tools.length > 0) {
      console.log(`    Tools: ${r.tools.join(", ")}`);
    }
  }

  console.log(`\n${SEP}`);
  console.log(`ZOD ERROR EXPLANATION:`);
  console.log(`  Claude Desktop uses Zod to validate every tool schema.`);
  console.log(`  Common causes:`);
  console.log(`    - inputSchema.type != "object"`);
  console.log(`    - inputSchema.properties missing`);
  console.log(`    - initialize response missing required fields`);
  console.log(`    - Tool responding with non-array content`);
  console.log(SEP + "\n");
}

main().catch(console.error);
