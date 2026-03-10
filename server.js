#!/usr/bin/env node
/**
 * Sol MCP Server — Solana Crypto Analysis Tools
 * 
 * Exposes Sol's Railway-deployed APIs as MCP tools:
 *   - get_token_risk: Risk score + analysis for any Solana token
 *   - get_momentum_signal: Buy/sell momentum signal for any token
 *   - batch_token_risk: Risk scores for up to 10 tokens at once
 *   - get_full_analysis: Risk + momentum combined
 * 
 * Usage:
 *   node server.js           → stdio mode (Claude Desktop / Cursor)
 *   node server.js --http    → HTTP mode (remote, for xpay.sh proxy)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { randomUUID } from "crypto";

const RISK_API = "https://sol-risk-production.up.railway.app";
const MOMENTUM_API = "https://momentum-signal-production.up.railway.app";

// ─── Tool helpers ─────────────────────────────────────────────────────────────

async function fetchRisk(mint) {
  const res = await fetch(`${RISK_API}/risk/${mint}`);
  if (!res.ok) throw new Error(`Risk API error: ${res.status}`);
  return res.json();
}

async function fetchMomentum(mint) {
  const res = await fetch(`${MOMENTUM_API}/analyze/${mint}`);
  if (!res.ok) throw new Error(`Momentum API error: ${res.status}`);
  return res.json();
}

// ─── Create server factory ────────────────────────────────────────────────────

function createMcpServer() {
  const server = new McpServer({
    name: "sol-crypto-analysis",
    version: "1.0.0",
    description:
      "Real-time Solana token risk scoring and momentum signals. " +
      "Powered by Sol's on-chain analysis engine.",
  });

  // Tool: get_token_risk
  server.tool(
    "get_token_risk",
    "Get a risk score (0–100) and risk label for a Solana token mint address. " +
      "LOW (0-30) = safer, HIGH (56-75) = risky, EXTREME (76-100) = likely rug. " +
      "Analyzes liquidity, whale concentration, holder count, and volume patterns.",
    {
      mint: z
        .string()
        .describe("Solana token mint address (base58 encoded)."),
    },
    async ({ mint }) => {
      try {
        const data = await fetchRisk(mint);
        const score = data.risk_score ?? data.score ?? "N/A";
        const label = data.risk_label ?? "UNKNOWN";
        const summary = data.summary ?? "";
        const flags = data.flags?.length ? `\nFlags: ${data.flags.join(", ")}` : "";
        const holders = data.holder_count ? `\nHolders: ${data.holder_count}` : "";
        const liquidity = data.liquidity_usd
          ? `\nLiquidity: $${data.liquidity_usd.toLocaleString()}`
          : "";
        const whale =
          data.whale_concentration_pct != null
            ? `\nWhale concentration: ${data.whale_concentration_pct.toFixed(1)}%`
            : "";

        const text =
          `Token: ${mint}\n` +
          `Risk Score: ${score}/100 (${label})\n` +
          (summary ? `Summary: ${summary}` : "") +
          holders +
          liquidity +
          whale +
          flags;

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: get_momentum_signal
  server.tool(
    "get_momentum_signal",
    "Get a buy/sell momentum signal for a Solana token based on multi-window buy/sell ratio analysis. " +
      "Returns STRONG_BUY / BUY / NEUTRAL / SELL / STRONG_SELL with confidence level.",
    {
      mint: z.string().describe("Solana token mint address (base58 encoded)."),
    },
    async ({ mint }) => {
      try {
        const data = await fetchMomentum(mint);
        const signal = data.signal ?? "UNKNOWN";
        const score = data.momentum_score ?? "N/A";
        const confidence = data.confidence ?? "UNKNOWN";
        const symbol = data.symbol ?? mint.slice(0, 8) + "...";

        let windows = "";
        if (data.windows) {
          const w = data.windows;
          windows =
            `\nM5:  buys=${w.m5?.buys ?? "?"} sells=${w.m5?.sells ?? "?"} ratio=${w.m5?.ratio?.toFixed(2) ?? "?"}` +
            `\nH1:  buys=${w.h1?.buys ?? "?"} sells=${w.h1?.sells ?? "?"} ratio=${w.h1?.ratio?.toFixed(2) ?? "?"}` +
            `\nH6:  buys=${w.h6?.buys ?? "?"} sells=${w.h6?.sells ?? "?"} ratio=${w.h6?.ratio?.toFixed(2) ?? "?"}`;
        }

        const text =
          `Token: ${symbol} (${mint})\n` +
          `Signal: ${signal}\n` +
          `Momentum Score: ${score}/100\n` +
          `Confidence: ${confidence}` +
          windows;

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: batch_token_risk
  server.tool(
    "batch_token_risk",
    "Get risk scores for multiple Solana tokens (up to 10) in one call. " +
      "Returns results sorted by risk score, lowest (safest) first.",
    {
      mints: z
        .array(z.string())
        .min(1)
        .max(10)
        .describe("Array of Solana token mint addresses, 1–10 items."),
    },
    async ({ mints }) => {
      try {
        const results = await Promise.allSettled(mints.map(fetchRisk));
        const rows = results.map((r, i) => {
          if (r.status === "rejected") {
            return { mint: mints[i], score: null, label: "ERROR", error: r.reason.message };
          }
          const d = r.value;
          return {
            mint: mints[i],
            score: d.risk_score ?? d.score ?? null,
            label: d.risk_label ?? "UNKNOWN",
          };
        });

        rows.sort((a, b) => {
          if (a.score === null) return 1;
          if (b.score === null) return -1;
          return a.score - b.score;
        });

        const lines = rows.map((r) => {
          if (r.error) return `❌ ${r.mint.slice(0, 12)}... ERROR: ${r.error}`;
          const bar = "█".repeat(Math.floor((r.score ?? 0) / 10));
          return `${r.label.padEnd(8)} ${String(r.score).padStart(3)}/100 ${bar}  ${r.mint}`;
        });

        const text =
          `Batch Risk Analysis — ${mints.length} tokens (safest first):\n\n` +
          lines.join("\n");

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Batch error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: get_full_analysis
  server.tool(
    "get_full_analysis",
    "Get both risk score AND momentum signal for a token in one call. " +
      "Combined verdict: low risk + strong buy = best setup for entry.",
    {
      mint: z.string().describe("Solana token mint address (base58 encoded)."),
    },
    async ({ mint }) => {
      try {
        const [riskResult, momentumResult] = await Promise.allSettled([
          fetchRisk(mint),
          fetchMomentum(mint),
        ]);

        let text = `Full Analysis: ${mint}\n${"─".repeat(50)}\n`;

        if (riskResult.status === "fulfilled") {
          const d = riskResult.value;
          const score = d.risk_score ?? d.score ?? "N/A";
          const label = d.risk_label ?? "UNKNOWN";
          text += `RISK: ${score}/100 (${label})\n`;
          if (d.summary) text += `${d.summary}\n`;
          if (d.liquidity_usd) text += `Liquidity: $${d.liquidity_usd.toLocaleString()}\n`;
          if (d.whale_concentration_pct != null)
            text += `Whale conc: ${d.whale_concentration_pct.toFixed(1)}%\n`;
          if (d.flags?.length) text += `Flags: ${d.flags.join(", ")}\n`;
        } else {
          text += `RISK: Error — ${riskResult.reason.message}\n`;
        }

        text += "\n";

        if (momentumResult.status === "fulfilled") {
          const d = momentumResult.value;
          text += `MOMENTUM: ${d.signal ?? "UNKNOWN"} (${d.confidence ?? "?"})\n`;
          text += `Score: ${d.momentum_score ?? "N/A"}/100\n`;
          if (d.windows) {
            const w = d.windows;
            text += `M5: ${w.m5?.ratio?.toFixed(2) ?? "?"} | H1: ${w.h1?.ratio?.toFixed(2) ?? "?"} | H6: ${w.h6?.ratio?.toFixed(2) ?? "?"}\n`;
          }
        } else {
          text += `MOMENTUM: Error — ${momentumResult.reason.message}\n`;
        }

        const riskScore =
          riskResult.status === "fulfilled"
            ? riskResult.value.risk_score ?? riskResult.value.score ?? 100
            : 100;
        const signal =
          momentumResult.status === "fulfilled"
            ? momentumResult.value.signal ?? "NEUTRAL"
            : "NEUTRAL";

        text += "\n";
        if (riskScore <= 30 && signal.includes("BUY")) {
          text += "✅ VERDICT: Strong setup — low risk + buy signal";
        } else if (riskScore <= 65 && signal.includes("BUY")) {
          text += "🟡 VERDICT: Moderate setup — watch closely";
        } else if (riskScore > 70) {
          text += "🔴 VERDICT: High risk — avoid";
        } else {
          text += "⚪ VERDICT: Neutral — no clear edge";
        }

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// ─── Transport ────────────────────────────────────────────────────────────────

const isHttp = process.argv.includes("--http");

if (isHttp) {
  // HTTP/Streamable mode — one server instance per session
  const app = express();
  app.use(express.json());

  const sessions = new Map(); // sessionId → { server, transport }

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];

    if (sessionId && sessions.has(sessionId)) {
      // Existing session
      const { transport } = sessions.get(sessionId);
      await transport.handleRequest(req, res, req.body);
    } else {
      // New session — create fresh server + transport
      const newSessionId = sessionId || randomUUID();
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (id) => {
          sessions.set(id, { server, transport });
        },
      });
      transport.onclose = () => {
        sessions.delete(newSessionId);
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "No active session. POST /mcp to initialize." });
      return;
    }
    await sessions.get(sessionId).transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId).transport.close();
      sessions.delete(sessionId);
    }
    res.status(200).json({ ok: true });
  });

  app.get("/health", (_, res) =>
    res.json({
      status: "ok",
      server: "sol-crypto-analysis",
      version: "1.0.0",
      tools: ["get_token_risk", "get_momentum_signal", "batch_token_risk", "get_full_analysis"],
      activeSessions: sessions.size,
    })
  );

  const PORT = process.env.PORT || 3100;
  app.listen(PORT, () => {
    process.stderr.write(`Sol MCP Server (HTTP) on http://localhost:${PORT}/mcp\n`);
  });
} else {
  // Stdio mode — single server instance
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
