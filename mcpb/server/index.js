#!/usr/bin/env node
/**
 * Bindery MCP — Node.js stdio bridge for the native Rust MCP server.
 *
 * This thin wrapper spawns the Rust binary inside WSL and pipes stdio
 * through so Claude Desktop can talk to it via the standard MCP protocol.
 *
 * The Rust binary path is taken from BINDERY_WSL_BINARY (set by the mcpb
 * manifest via user_config). The source directory is derived from it so that
 * dotenvy can find the .env file alongside the binary's build root.
 * All other env vars are forwarded from the manifest and take precedence over
 * anything in .env.
 */

const { spawn } = require("child_process");

// ── Configuration ───────────────────────────────────────────────────────────

// Full WSL path to the compiled Rust binary.
// Derived from user_config.wsl_binary in the manifest.
const WSL_BINARY = process.env.BINDERY_WSL_BINARY
  || "/home/user/bindery_source/target/release/bindery-mcp";

// Derive the source root (two levels up from target/release/<binary>).
// This is where dotenvy looks for .env.
function sourceDir(binaryPath) {
  const parts = binaryPath.split("/");
  const releaseIdx = parts.lastIndexOf("release");
  if (releaseIdx >= 2) return parts.slice(0, releaseIdx - 1).join("/");
  // Fallback: same directory as binary
  return parts.slice(0, -1).join("/");
}

// Build the environment block to forward into WSL.
// The mcpb manifest injects these from user_config; they take precedence over .env.
const ENV_VARS = [
  "BINDERY_SOURCE_ROOT",
  "BINDERY_WORK_ROOT",
  "BINDERY_INDEX_DIR",
  "BINDERY_EMBEDDINGS_BACKEND",
  "BINDERY_ONNX_URL",
  "BINDERY_ONNX_PORT",
  "BINDERY_ONNX_MODEL",
  "BINDERY_ONNX_SERVER_DIR",
  "BINDERY_MAX_RESPONSE_BYTES",
  "BINDERY_SNIPPET_MAX_CHARS",
  "BINDERY_DEFAULT_TOPK",
  "BINDERY_AUTHOR",
];

// ── Spawn the Rust MCP server via WSL ───────────────────────────────────────

function buildEnvExports() {
  return ENV_VARS
    .filter((key) => process.env[key] && process.env[key] !== "" && !process.env[key].startsWith("${"))
    .map((key) => `export ${key}=${JSON.stringify(process.env[key])}`)
    .join("; ");
}

function start() {
  const dir = sourceDir(WSL_BINARY);
  const envExports = buildEnvExports();

  // cd to the source root (so dotenvy finds .env), then exec the binary directly.
  // Env vars from the manifest are exported first and override .env for overlapping keys.
  const wslCommand = [
    envExports,
    `cd ${JSON.stringify(dir)}`,
    `exec ${JSON.stringify(WSL_BINARY)}`,
  ].filter(Boolean).join("; ");

  const child = spawn("wsl.exe", ["--", "bash", "-c", wslCommand], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  // Bridge stdio: Claude Desktop <-> this process <-> WSL Rust binary
  process.stdin.pipe(child.stdin);
  child.stdout.pipe(process.stdout);

  // Forward stderr for diagnostics (won't interfere with MCP protocol on stdout)
  child.stderr.on("data", (data) => {
    process.stderr.write(data);
  });

  child.on("error", (err) => {
    process.stderr.write(`[bindery-bridge] Failed to start WSL process: ${err.message}\n`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.stderr.write(`[bindery-bridge] WSL process killed by signal ${signal}\n`);
      process.exit(1);
    }
    process.exit(code ?? 0);
  });

  // If the parent process (Claude Desktop) closes stdin, propagate to child
  process.stdin.on("end", () => {
    child.stdin.end();
  });

  // Handle parent process termination gracefully
  function cleanup() {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 3000);
  }

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGHUP", cleanup);
}

start();
