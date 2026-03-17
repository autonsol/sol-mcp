#!/usr/bin/env node
/**
 * Sol MCP Server — Solana Crypto Analysis Tools
 * 
 * Exposes Sol's Railway-deployed APIs as MCP tools:
 *   - get_token_risk: Risk score + analysis for any Solana token
 *   - get_momentum_signal: Buy/sell momentum signal for any token
 *   - batch_token_risk: Risk scores for up to 10 tokens at once
 *   - get_full_analysis: Risk + momentum combined
 *   - get_graduation_signals: Live BUY/SKIP decisions from Sol's graduation alert engine
 *   - get_trading_performance: Live trading stats (win rate, PnL, recent trades)
 * 
 * Tiers:
 *   FREE  → /mcp/free   — 4 tools (get_token_risk, get_momentum_signal,
 *                           get_graduation_signals, get_trading_performance)
 *   PRO   → /mcp        — All 6 tools via xpay.sh paywall ($0.01/call)
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
const GRAD_ALERT_API = "https://grad-alert-production.up.railway.app";

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
    version: "1.5.0",
    description:
      "PRO tier — Real-time Solana token risk scoring, momentum signals, and graduation alert decisions. " +
      "All 6 tools including batch analysis. $0.01/call via xpay.sh (USDC, Base mainnet). " +
      "FREE tier available at /mcp/free (5 tools including get_pro_features, no cost).",
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
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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

  // Tool: get_graduation_signals
  server.tool(
    "get_graduation_signals",
    "Get recent token graduation signal decisions from Sol's on-chain analysis engine. " +
      "Shows which pump.fun tokens were flagged as BUY or SKIP, with full reasoning. " +
      "Tokens are evaluated at graduation (bonding curve completion) using risk score + momentum. " +
      "BUY signals have risk ≤65 and strong momentum (2.0–3.0× ratio depending on risk tier). " +
      "Use this to discover tokens Sol's AI has vetted as worth trading.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Number of recent decisions to return (1–50). Default: 10."),
      filter: z
        .enum(["all", "trade", "skip"])
        .default("all")
        .describe(
          "Filter by decision type: 'trade' (BUY signals only), 'skip' (filtered out), or 'all'."
        ),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ limit, filter }) => {
      try {
        const url = `${GRAD_ALERT_API}/decisions?limit=${limit}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Grad-alert API error: ${res.status}`);
        const data = await res.json();

        const decisions = data.decisions ?? [];
        const filtered = filter === "all"
          ? decisions
          : decisions.filter((d) => {
              if (filter === "trade") return d.decision === "TRADE";
              if (filter === "skip") return d.decision === "SKIP";
              return true;
            });

        const s = data.summary ?? {};
        let text =
          `Sol Graduation Signal Decisions (${data.version ?? "v?"}, ${data.agent_id ?? "sol"})\n` +
          `Generated: ${data.generated_at ?? "unknown"}\n` +
          `Total: ${s.total_decisions ?? 0} decisions — ` +
          `${s.trades ?? 0} TRADES, ${s.skips ?? 0} SKIPS\n`;

        if (s.win_rate_pct != null) {
          text += `Live Win Rate: ${s.win_rate_pct.toFixed(1)}%\n`;
        }

        const todFilter = data.timeOfDayFilter;
        if (todFilter) {
          const allowed = todFilter.tradingAllowed;
          text += `Trading now: ${allowed ? "✅ YES" : "🚫 NO (blocked hour UTC ${todFilter.currentUTCHour})"}\n`;
        }

        text += `\n${"─".repeat(55)}\n`;

        if (filtered.length === 0) {
          text += `No ${filter === "all" ? "" : filter + " "}decisions found in last ${limit} records.`;
        } else {
          for (const d of filtered) {
            const ts = d.timestamp
              ? new Date(d.timestamp).toISOString().slice(0, 16).replace("T", " ")
              : "?";
            const icon = d.decision === "TRADE" ? "🟢" : "🔴";
            const inp = d.inputs ?? {};
            text += `\n${icon} ${d.decision}  ${ts} UTC\n`;
            text += `  Token: ${inp.token ?? "?"} (${(inp.mint ?? "").slice(0, 12)}...)\n`;
            text += `  Risk: ${inp.risk_score ?? "?"}/100`;
            if (inp.momentum_ratio != null) text += `  Momentum: ${inp.momentum_ratio}× (buys ${inp.momentum_buys ?? "?"}/${(inp.momentum_buys ?? 0) + (inp.momentum_sells ?? 0)} total)`;
            text += `\n`;
            if (d.reasoning) text += `  Reason: ${d.reasoning}\n`;
            if (d.outcome) {
              const o = d.outcome;
              text += `  Outcome: ${o.result ?? "?"} ${o.pnl_sol != null ? `(${o.pnl_sol > 0 ? "+" : ""}${o.pnl_sol.toFixed(4)} SOL, ${o.multiple_x != null ? o.multiple_x.toFixed(2) + "×" : ""})` : ""}\n`;
            }
          }
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

  // Tool: get_trading_performance
  server.tool(
    "get_trading_performance",
    "Get Sol's live trading performance stats and recent closed trades. " +
      "Shows win rate, total PnL, ROI, and the most recent trade outcomes. " +
      "Sol trades pump.fun graduating tokens on Solana using a risk + momentum strategy. " +
      "Useful for evaluating signal quality before using get_graduation_signals for trade ideas.",
    {
      recent_count: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(5)
        .describe("Number of recent closed trades to show (1–20). Default: 5."),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ recent_count }) => {
      try {
        const res = await fetch(`${GRAD_ALERT_API}/real-trades?limit=${recent_count}`);
        if (!res.ok) throw new Error(`Trading API error: ${res.status}`);
        const data = await res.json();

        const st = data.stats ?? {};
        let text =
          `Sol Trading Performance (real capital, ${data.mode ?? "?"})\n` +
          `${"─".repeat(50)}\n` +
          `Total Trades: ${st.total_trades ?? 0}\n` +
          `Win Rate: ${st.win_rate_pct != null ? st.win_rate_pct.toFixed(1) + "%" : "N/A"} ` +
          `(${st.wins ?? 0}W / ${st.losses ?? 0}L)\n` +
          `Total PnL: ${st.total_pnl_sol != null ? (st.total_pnl_sol > 0 ? "+" : "") + st.total_pnl_sol.toFixed(4) : "?"} SOL\n` +
          `ROI: ${st.roi_pct != null ? (st.roi_pct > 0 ? "+" : "") + st.roi_pct.toFixed(2) + "%" : "?"}\n` +
          `Capital Deployed: ${st.capital_deployed_sol ?? "?"} SOL\n` +
          `Avg Hold: ${st.avg_hold_mins != null ? st.avg_hold_mins.toFixed(1) + " min" : "?"}\n` +
          `Best Trade: ${st.best_trade_sol != null ? "+" + st.best_trade_sol.toFixed(4) + " SOL" : "?"}\n` +
          `Worst Trade: ${st.worst_trade_sol != null ? st.worst_trade_sol.toFixed(4) + " SOL" : "?"}\n`;

        const open = data.open_positions ?? [];
        if (open.length > 0) {
          text += `\nOpen Positions: ${open.length}\n`;
          for (const p of open) {
            text += `  🔵 ${(p.mint ?? "?").slice(0, 12)}... risk=${p.risk_score ?? "?"} entry=${p.entry_sol ?? "?"}SOL\n`;
          }
        } else {
          text += `\nOpen Positions: None\n`;
        }

        const closed = data.recent_closed ?? [];
        if (closed.length > 0) {
          text += `\nRecent Closed Trades (${closed.length}):\n`;
          for (const t of closed) {
            const icon = t.exit_reason === "TP" ? "✅" : "❌";
            const pnl = t.pnl_sol != null ? `${t.pnl_sol > 0 ? "+" : ""}${t.pnl_sol.toFixed(4)} SOL` : "?";
            const mult = t.multiple_x != null ? `${t.multiple_x.toFixed(2)}×` : "?";
            const hold = t.hold_mins != null ? `${t.hold_mins}min` : "?";
            const ts = t.entry_time
              ? new Date(t.entry_time).toISOString().slice(0, 16).replace("T", " ")
              : "?";
            text += `  ${icon} ${ts} UTC | risk=${t.risk_score ?? "?"} | ${pnl} (${mult}) | held ${hold} | exit=${t.exit_reason ?? "?"}\n`;
          }
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

// ─── Free Tier Server (4 tools, no paywall) ───────────────────────────────────

function createFreeMcpServer() {
  const server = new McpServer({
    name: "sol-crypto-analysis-free",
    version: "1.5.0",
    description:
      "FREE tier — Real-time Solana token risk scoring, momentum signals, and graduation alert decisions. " +
      "Includes 4 tools. Upgrade to PRO (via paywall.xpay.sh/sol-mcp) for batch_token_risk and get_full_analysis ($0.01/call USDC).",
  });

  // Register all 4 free tools by re-using the full server's tool definitions.
  // We achieve this by creating the full server and filtering — but it's cleaner
  // to register independently so the description accurately reflects free tier.

  server.tool(
    "get_token_risk",
    "[FREE] Get a risk score (0–100) and risk label for a Solana token mint address. " +
      "LOW (0-30) = safer, HIGH (56-75) = risky, EXTREME (76-100) = likely rug. " +
      "Analyzes liquidity, whale concentration, holder count, and volume patterns.",
    { mint: z.string().describe("Solana token mint address (base58 encoded).") },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ mint }) => {
      try {
        const data = await fetchRisk(mint);
        const score = data.risk_score ?? data.score ?? "N/A";
        const label = data.risk_label ?? "UNKNOWN";
        const summary = data.summary ?? "";
        const flags = data.flags?.length ? `\nFlags: ${data.flags.join(", ")}` : "";
        const holders = data.holder_count ? `\nHolders: ${data.holder_count}` : "";
        const liquidity = data.liquidity_usd
          ? `\nLiquidity: $${data.liquidity_usd.toLocaleString()}` : "";
        const whale = data.whale_concentration_pct != null
          ? `\nWhale concentration: ${data.whale_concentration_pct.toFixed(1)}%` : "";
        const text =
          `Token: ${mint}\n` +
          `Risk Score: ${score}/100 (${label})\n` +
          (summary ? `Summary: ${summary}` : "") +
          holders + liquidity + whale + flags +
          `\n\n─────────────────────────────────────\n` +
          `⚡ UPGRADE TO PRO — $0.01/call (USDC)\n` +
          `  get_full_analysis: risk + momentum in ONE call (vs 2 free calls)\n` +
          `  batch_token_risk: score 10 tokens at once\n` +
          `  → paywall.xpay.sh/sol-mcp`;
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_momentum_signal",
    "[FREE] Get a buy/sell momentum signal for a Solana token based on multi-window buy/sell ratio analysis. " +
      "Returns STRONG_BUY / BUY / NEUTRAL / SELL / STRONG_SELL with confidence level.",
    { mint: z.string().describe("Solana token mint address (base58 encoded).") },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
        const actionLine = signal.includes("BUY")
          ? `\n💡 Signal looks bullish? get_full_analysis (PRO) gives you risk + momentum in 1 call.`
          : signal.includes("SELL")
          ? `\n💡 Bearish signal? Combine with get_token_risk (free) or get_full_analysis (PRO, 1 call).`
          : `\n💡 PRO: get_full_analysis combines risk + momentum in 1 call vs 2 free calls.`;
        const text =
          `Token: ${symbol} (${mint})\n` +
          `Signal: ${signal}\n` +
          `Momentum Score: ${score}/100\n` +
          `Confidence: ${confidence}` + windows +
          actionLine +
          `\n→ paywall.xpay.sh/sol-mcp ($0.01/call USDC)`;
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_graduation_signals",
    "[FREE] Get recent token graduation signal decisions from Sol's on-chain analysis engine. " +
      "Shows which pump.fun tokens were flagged as BUY or SKIP, with full reasoning. " +
      "BUY signals have risk ≤65 and strong momentum (2.0–3.0× ratio depending on risk tier).",
    {
      limit: z.number().int().min(1).max(50).default(10)
        .describe("Number of recent decisions to return (1–50). Default: 10."),
      filter: z.enum(["all", "trade", "skip"]).default("all")
        .describe("Filter: 'trade' (BUY signals only), 'skip' (filtered out), or 'all'."),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ limit, filter }) => {
      try {
        const url = `${GRAD_ALERT_API}/decisions?limit=${limit}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Grad-alert API error: ${res.status}`);
        const data = await res.json();
        const decisions = data.decisions ?? [];
        const filtered = filter === "all" ? decisions
          : decisions.filter((d) => filter === "trade" ? d.decision === "TRADE" : d.decision === "SKIP");
        const s = data.summary ?? {};
        let text =
          `Sol Graduation Signal Decisions (${data.version ?? "v?"}, ${data.agent_id ?? "sol"})\n` +
          `Generated: ${data.generated_at ?? "unknown"}\n` +
          `Total: ${s.total_decisions ?? 0} decisions — ${s.trades ?? 0} TRADES, ${s.skips ?? 0} SKIPS\n`;
        if (s.win_rate_pct != null) text += `Live Win Rate: ${s.win_rate_pct.toFixed(1)}%\n`;
        text += `\n${"─".repeat(55)}\n`;
        const tradeCount = filtered.filter(d => d.decision === "TRADE").length;
        if (filtered.length === 0) {
          text += `No ${filter === "all" ? "" : filter + " "}decisions found in last ${limit} records.`;
        } else {
          for (const d of filtered) {
            const ts = d.timestamp
              ? new Date(d.timestamp).toISOString().slice(0, 16).replace("T", " ") : "?";
            const icon = d.decision === "TRADE" ? "🟢" : "🔴";
            const inp = d.inputs ?? {};
            text += `\n${icon} ${d.decision}  ${ts} UTC\n`;
            text += `  Token: ${inp.token ?? "?"} (${(inp.mint ?? "").slice(0, 12)}...)\n`;
            text += `  Risk: ${inp.risk_score ?? "?"}/100`;
            if (inp.momentum_ratio != null)
              text += `  Momentum: ${inp.momentum_ratio}× (buys ${inp.momentum_buys ?? "?"}/${(inp.momentum_buys ?? 0) + (inp.momentum_sells ?? 0)} total)`;
            text += `\n`;
            if (d.reasoning) text += `  Reason: ${d.reasoning}\n`;
          }
        }
        if (tradeCount > 0) {
          text +=
            `\n─────────────────────────────────────\n` +
            `⚡ ${tradeCount} BUY signal${tradeCount > 1 ? "s" : ""} above — screen the mints faster with PRO:\n` +
            `  batch_token_risk: risk scores for 10 tokens in 1 call\n` +
            `  get_full_analysis: risk + momentum for any token in 1 call\n` +
            `  → paywall.xpay.sh/sol-mcp ($0.01/call USDC, Base mainnet)`;
        }
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_trading_performance",
    "[FREE] Get Sol's live trading performance stats and recent closed trades. " +
      "Shows win rate, total PnL, ROI, and the most recent trade outcomes. " +
      "Sol trades pump.fun graduating tokens on Solana using a risk + momentum strategy.",
    {
      recent_count: z.number().int().min(1).max(20).default(5)
        .describe("Number of recent closed trades to show (1–20). Default: 5."),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ recent_count }) => {
      try {
        const res = await fetch(`${GRAD_ALERT_API}/real-trades?limit=${recent_count}`);
        if (!res.ok) throw new Error(`Trading API error: ${res.status}`);
        const data = await res.json();
        const st = data.stats ?? {};
        let text =
          `Sol Trading Performance (real capital, ${data.mode ?? "?"})\n` +
          `${"─".repeat(50)}\n` +
          `Total Trades: ${st.total_trades ?? 0}\n` +
          `Win Rate: ${st.win_rate_pct != null ? st.win_rate_pct.toFixed(1) + "%" : "N/A"} ` +
          `(${st.wins ?? 0}W / ${st.losses ?? 0}L)\n` +
          `Total PnL: ${st.total_pnl_sol != null ? (st.total_pnl_sol > 0 ? "+" : "") + st.total_pnl_sol.toFixed(4) : "?"} SOL\n` +
          `ROI: ${st.roi_pct != null ? (st.roi_pct > 0 ? "+" : "") + st.roi_pct.toFixed(2) + "%" : "?"}\n`;
        const closed = data.recent_closed ?? [];
        if (closed.length > 0) {
          text += `\nRecent Closed Trades:\n`;
          for (const t of closed) {
            const icon = t.exit_reason === "TP" ? "✅" : "❌";
            const pnl = t.pnl_sol != null ? `${t.pnl_sol > 0 ? "+" : ""}${t.pnl_sol.toFixed(4)} SOL` : "?";
            const mult = t.multiple_x != null ? `${t.multiple_x.toFixed(2)}×` : "?";
            const ts = t.entry_time
              ? new Date(t.entry_time).toISOString().slice(0, 16).replace("T", " ") : "?";
            text += `  ${icon} ${ts} UTC | risk=${t.risk_score ?? "?"} | ${pnl} (${mult}) | exit=${t.exit_reason ?? "?"}\n`;
          }
        }
        text +=
          `\n─────────────────────────────────────\n` +
          `⚡ Want to follow these signals yourself? PRO tools:\n` +
          `  get_full_analysis: risk + momentum for any token in 1 call\n` +
          `  batch_token_risk: screen 10 tokens at once\n` +
          `  → paywall.xpay.sh/sol-mcp ($0.01/call USDC)`;
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // Tool: get_pro_features (free tier conversion hook)
  server.tool(
    "get_pro_features",
    "List all PRO tier tools and how to upgrade. " +
      "PRO adds batch_token_risk (10 tokens in 1 call) and get_full_analysis (risk + momentum combined). " +
      "$0.01/call USDC via xpay.sh — no subscription, pay only when you use it.",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async () => {
      const text =
        `Sol MCP — PRO Tier Features\n` +
        `${"═".repeat(45)}\n\n` +
        `Current tier: FREE (4 tools, no limit)\n` +
        `PRO tier: $0.01/call USDC — pay per use, no subscription\n` +
        `Payment: Base mainnet USDC via xpay.sh (EVM wallet needed)\n\n` +
        `FREE tools (available now):\n` +
        `  ✅ get_token_risk         — risk score for 1 token\n` +
        `  ✅ get_momentum_signal    — buy/sell momentum for 1 token\n` +
        `  ✅ get_graduation_signals — Sol's live BUY/SKIP decisions\n` +
        `  ✅ get_trading_performance — win rate, PnL, recent trades\n\n` +
        `PRO-only tools (unlock at paywall.xpay.sh/sol-mcp):\n` +
        `  🔒 batch_token_risk      — risk scores for 10 tokens in 1 call\n` +
        `     → saves 9 API calls when screening a watchlist\n` +
        `  🔒 get_full_analysis     — risk + momentum combined in 1 call\n` +
        `     → saves 1 call per token vs using 2 free tools separately\n\n` +
        `How to upgrade:\n` +
        `  1. Go to: https://paywall.xpay.sh/sol-mcp\n` +
        `  2. Connect an EVM wallet (MetaMask, Coinbase, etc.)\n` +
        `  3. Fund with USDC on Base mainnet (any amount)\n` +
        `  4. Use the PRO endpoint: https://sol-mcp-production.up.railway.app/mcp\n\n` +
        `Questions? Sol is on Telegram: @autonsol`;
      return { content: [{ type: "text", text }] };
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
  const freeSessions = new Map(); // sessionId → { server, transport } (free tier)

  // ── Free tier: /mcp/free ─────────────────────────────────────────────────
  app.post("/mcp/free", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && freeSessions.has(sessionId)) {
      const { transport } = freeSessions.get(sessionId);
      await transport.handleRequest(req, res, req.body);
    } else {
      const newSessionId = sessionId || randomUUID();
      const server = createFreeMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (id) => {
          freeSessions.set(id, { server, transport });
        },
      });
      transport.onclose = () => { freeSessions.delete(newSessionId); };
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    }
  });

  app.get("/mcp/free", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !freeSessions.has(sessionId)) {
      res.status(400).json({ error: "No active session. POST /mcp/free to initialize." });
      return;
    }
    await freeSessions.get(sessionId).transport.handleRequest(req, res);
  });

  app.delete("/mcp/free", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && freeSessions.has(sessionId)) {
      await freeSessions.get(sessionId).transport.close();
      freeSessions.delete(sessionId);
    }
    res.status(200).json({ ok: true });
  });

  // ── Pro tier: /mcp (all 6 tools, served behind xpay.sh paywall) ─────────
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

  // ── Agent Card — ERC-8004 / A2A standard ─────────────────────────────────
  // Required for ERC-8004 registration and agent-to-agent discovery.
  // Spec: https://eips.ethereum.org/EIPS/eip-8004
  app.get("/.well-known/agent-card.json", (_, res) => {
    res.json({
      schemaVersion: "1.0",
      name: "Sol",
      description:
        "Autonomous AI trading agent specialized in Solana DeFi — token risk scoring, " +
        "momentum signals, and pump.fun graduation trading with verifiable on-chain track record. " +
        "Every trade is logged and publicly auditable. Cross-chain: Solana execution + EVM trust layer (ERC-8004).",
      url: "https://sol-mcp-production.up.railway.app",
      version: "1.5.0",
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false,
        x402Payments: true,
      },
      defaultInputModes: ["text/plain", "application/json"],
      defaultOutputModes: ["text/plain"],
      skills: [
        {
          id: "token_risk_scoring",
          name: "Token Risk Scoring",
          description:
            "On-chain risk analysis for Solana tokens: liquidity, whale concentration, " +
            "holder count, contract flags. Returns 0-100 score with risk label (LOW/MEDIUM/HIGH/EXTREME).",
          tags: ["solana", "defi", "risk", "meme-coins", "pump.fun"],
          examples: [
            "What is the risk score for this Solana token?",
            "Is this pump.fun token safe to trade?",
            "Analyze token risk for mint address XYZ",
          ],
        },
        {
          id: "momentum_signals",
          name: "Momentum Signal Detection",
          description:
            "Multi-window buy/sell momentum signals for Solana tokens (M5/H1/H6). " +
            "Returns STRONG_BUY / BUY / NEUTRAL / SELL / STRONG_SELL with confidence.",
          tags: ["solana", "trading", "signals", "momentum", "defi"],
          examples: [
            "What is the momentum signal for this token?",
            "Is there buy pressure on this Solana token?",
          ],
        },
        {
          id: "graduation_trading",
          name: "pump.fun Graduation Alert & Trading",
          description:
            "Autonomous trading agent monitoring pump.fun graduation events 24/7. " +
            "Evaluates tokens using risk+momentum composite and executes trades. " +
            "Real capital, verifiable PnL. 7 closed trades: 2 TP / 5 SL.",
          tags: ["solana", "pump.fun", "trading", "autonomous", "graduation"],
          examples: [
            "What are Sol's recent graduation trading signals?",
            "Show me Sol's live trading performance",
          ],
        },
        {
          id: "batch_risk_analysis",
          name: "Batch Token Risk Analysis",
          description:
            "Risk scores for up to 10 Solana tokens in one API call. " +
            "PRO tier only (requires x402 payment).",
          tags: ["solana", "risk", "batch", "portfolio"],
        },
      ],
      provider: {
        organization: "autonsol",
        url: "https://github.com/autonsol",
        contact: "https://t.me/autonsol",
      },
      authentication: {
        schemes: ["none", "x402"],
        freeTier: {
          endpoint: "https://sol-mcp-production.up.railway.app/mcp/free",
          tools: ["get_token_risk", "get_momentum_signal", "get_graduation_signals", "get_trading_performance", "get_pro_features"],
          price: "FREE — no auth required",
        },
        x402: {
          endpoint: "https://paywall.xpay.sh/sol-mcp",
          pricePerCall: "0.01",
          currency: "USDC",
          network: "base-mainnet",
          paymentAddress: "0xa18853fbaf559e73307458c2488a2cf214d0ca7c",
        },
      },
      serviceEndpoints: {
        mcp_free: "https://sol-mcp-production.up.railway.app/mcp/free",
        mcp_pro_paywall: "https://paywall.xpay.sh/sol-mcp",
        agent_card: "https://sol-mcp-production.up.railway.app/.well-known/agent-card.json",
        trading_decisions: "https://grad-alert-production.up.railway.app/decisions",
        trading_performance: "https://grad-alert-production.up.railway.app/real-trades",
        token_risk: "https://sol-risk-production.up.railway.app/risk/{mint}",
        momentum: "https://momentum-signal-production.up.railway.app/analyze/{mint}",
      },
      erc8004: {
        network: "base-mainnet",
        identity: "pending_registration",
        tags: ["tradingYield", "solana", "graduation-trading", "risk-scoring"],
        reputationReporter: true,
        tradingYield: true,
      },
      safetyRating: {
        autonomous: true,
        realCapitalTrading: true,
        maxPositionSol: 0.02,
        riskThreshold: 65,
      },
    });
  });

  // ── Landing page ────────────────────────────────────────────────────────
  app.get("/", async (_, res) => {
    // Fetch live stats for display
    let gradStats = { win_rate_pct: null, total_trades: null, avg_pnl_pct: null };
    let decisions = { total_decisions: null, tradeable_pct: null };
    try {
      const [ptRes, decRes] = await Promise.allSettled([
        fetch(`${GRAD_ALERT_API}/paper-trades?limit=1`),
        fetch(`${GRAD_ALERT_API}/decisions?limit=1`),
      ]);
      if (ptRes.status === 'fulfilled' && ptRes.value.ok) {
        const d = await ptRes.value.json();
        gradStats = d.stats ?? gradStats;
      }
      if (decRes.status === 'fulfilled' && decRes.value.ok) {
        const d = await decRes.value.json();
        decisions = d.summary ?? decisions;
      }
    } catch {}

    const wrLabel = gradStats.win_rate_pct != null ? `${gradStats.win_rate_pct.toFixed(1)}%` : '—';
    const tradeLabel = gradStats.total_trades != null ? `${gradStats.total_trades}+` : '—';
    const pnlLabel = gradStats.avg_pnl_pct != null ? `${gradStats.avg_pnl_pct > 0 ? '+' : ''}${gradStats.avg_pnl_pct.toFixed(1)}%` : '—';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sol MCP — Solana Token Risk & Signals</title>
  <style>
    :root { --bg:#0a0a0f; --surface:#12121a; --surface2:#1a1a26; --accent:#9945ff; --accent2:#14f195; --text:#e8e8f0; --muted:#6e6e8a; --border:#2a2a3e; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; line-height:1.6; }
    a { color:var(--accent2); text-decoration:none; }
    a:hover { text-decoration:underline; }
    .container { max-width:860px; margin:0 auto; padding:40px 24px; }
    .hero { text-align:center; padding:60px 0 40px; }
    .hero h1 { font-size:2.4rem; font-weight:700; background:linear-gradient(135deg,#9945ff,#14f195); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:12px; }
    .hero p { font-size:1.1rem; color:var(--muted); max-width:560px; margin:0 auto 28px; }
    .badge { display:inline-block; background:var(--surface2); border:1px solid var(--border); border-radius:20px; padding:6px 14px; font-size:0.78rem; color:var(--muted); margin:4px; }
    .badge.green { border-color:#14f19544; color:#14f195; }
    .badge.purple { border-color:#9945ff44; color:#b07aff; }
    .stats { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin:40px 0; }
    .stat { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:20px; text-align:center; }
    .stat .num { font-size:2rem; font-weight:700; color:var(--accent2); }
    .stat .label { font-size:0.82rem; color:var(--muted); margin-top:4px; }
    .tiers { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin:40px 0; }
    .tier { background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:28px; }
    .tier.pro { border-color:#9945ff66; background:linear-gradient(160deg,#12121a,#1a0f2e); }
    .tier h3 { font-size:1.1rem; font-weight:700; margin-bottom:6px; }
    .tier .price { font-size:1.6rem; font-weight:800; color:var(--accent2); margin:8px 0 14px; }
    .tier.pro .price { color:#b07aff; }
    .tier ul { list-style:none; }
    .tier ul li { padding:4px 0; font-size:0.9rem; color:var(--muted); }
    .tier ul li::before { content:"✓ "; color:var(--accent2); }
    .tier.pro ul li::before { color:#9945ff; }
    .cta { display:inline-block; margin-top:18px; padding:10px 22px; border-radius:8px; font-size:0.9rem; font-weight:600; }
    .cta.free { background:var(--surface2); border:1px solid var(--border); color:var(--text); }
    .cta.pro { background:linear-gradient(135deg,#9945ff,#6e2db3); color:white; }
    .cta:hover { opacity:0.9; text-decoration:none; }
    .tools { margin:40px 0; }
    .tools h2 { font-size:1.3rem; font-weight:700; margin-bottom:18px; color:var(--text); }
    .tool { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px 20px; margin-bottom:10px; display:flex; align-items:flex-start; gap:14px; }
    .tool-icon { font-size:1.4rem; margin-top:2px; }
    .tool-name { font-weight:600; font-size:0.95rem; }
    .tool-desc { font-size:0.85rem; color:var(--muted); margin-top:3px; }
    .pro-tag { background:#9945ff22; border:1px solid #9945ff44; color:#b07aff; font-size:0.7rem; padding:2px 8px; border-radius:10px; margin-left:8px; vertical-align:middle; }
    .install { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:28px; margin:40px 0; }
    .install h2 { font-size:1.2rem; font-weight:700; margin-bottom:16px; }
    .install pre { background:var(--surface2); border:1px solid var(--border); border-radius:8px; padding:14px 18px; font-size:0.88rem; overflow-x:auto; color:#a0e0c0; margin:10px 0; }
    .footer { text-align:center; padding:40px 0 20px; color:var(--muted); font-size:0.85rem; }
    @media(max-width:600px) { .tiers,.stats { grid-template-columns:1fr; } .hero h1 { font-size:1.8rem; } }
  </style>
</head>
<body>
<div class="container">
  <div class="hero">
    <h1>☀️ Sol MCP</h1>
    <p>Real-time Solana token risk scoring, momentum signals, and live graduation alerts — as MCP tools for AI agents.</p>
    <span class="badge green">✓ Live on Railway</span>
    <span class="badge purple">MCP 2025-03-26</span>
    <span class="badge">Streamable HTTP</span>
    <span class="badge">stdio</span>
  </div>

  <div class="stats">
    <div class="stat">
      <div class="num">${tradeLabel}</div>
      <div class="label">Paper Trades Analyzed</div>
    </div>
    <div class="stat">
      <div class="num">${wrLabel}</div>
      <div class="label">Strategy Win Rate</div>
    </div>
    <div class="stat">
      <div class="num">$0.01</div>
      <div class="label">Per PRO API Call</div>
    </div>
  </div>

  <div class="tiers">
    <div class="tier">
      <h3>Free Tier</h3>
      <div class="price">Free</div>
      <ul>
        <li>get_token_risk</li>
        <li>get_momentum_signal</li>
        <li>get_graduation_signals</li>
        <li>get_trading_performance</li>
        <li>get_pro_features (upgrade guide)</li>
      </ul>
      <a class="cta free" href="https://smithery.ai/server/@autonsol/sol-mcp" target="_blank">Install on Smithery →</a>
    </div>
    <div class="tier pro">
      <h3>PRO Tier</h3>
      <div class="price">$0.01/call</div>
      <ul>
        <li>All free tools</li>
        <li>batch_token_risk (up to 10 tokens)</li>
        <li>get_full_analysis (risk + momentum)</li>
        <li>USDC on Base mainnet</li>
        <li>Instant access via xpay.sh</li>
      </ul>
      <a class="cta pro" href="https://paywall.xpay.sh/sol-mcp" target="_blank">Upgrade to PRO →</a>
    </div>
  </div>

  <div class="tools">
    <h2>Available Tools</h2>
    <div class="tool"><div class="tool-icon">🛡️</div><div><div class="tool-name">get_token_risk</div><div class="tool-desc">Risk score 0–100 + label (LOW/MEDIUM/HIGH/EXTREME) for any Solana mint. Analyzes liquidity, whale concentration, holder count, volume patterns.</div></div></div>
    <div class="tool"><div class="tool-icon">📈</div><div><div class="tool-name">get_momentum_signal</div><div class="tool-desc">Buy/sell momentum at 75s and 120s post-graduation. BUY/WATCH/SKIP with ratio, buys, sells, liquidity, price change.</div></div></div>
    <div class="tool"><div class="tool-icon">🎓</div><div><div class="tool-name">get_graduation_signals</div><div class="tool-desc">Live decisions from Sol's graduation alert engine — tokens evaluated, skipped, and traded in the last N decisions.</div></div></div>
    <div class="tool"><div class="tool-icon">📊</div><div><div class="tool-name">get_trading_performance</div><div class="tool-desc">Sol's live trading stats: win rate, avg PnL, best trade, open positions, and recent closed trades.</div></div></div>
    <div class="tool"><div class="tool-icon">📦</div><div><div class="tool-name">batch_token_risk <span class="pro-tag">PRO</span></div><div class="tool-desc">Risk scores for up to 10 mints in a single call. Saves time when screening a portfolio or watchlist.</div></div></div>
    <div class="tool"><div class="tool-icon">🔍</div><div><div class="tool-name">get_full_analysis <span class="pro-tag">PRO</span></div><div class="tool-desc">Combined risk + momentum in one response. Includes entry recommendation, confidence, and reasoning.</div></div></div>
  </div>

  <div class="install">
    <h2>Quick Install</h2>
    <p style="color:var(--muted);font-size:0.9rem;margin-bottom:12px">Add to Claude Desktop, Cursor, or any MCP client:</p>
    <pre>{
  "mcpServers": {
    "sol-mcp": {
      "url": "https://sol-mcp-production.up.railway.app/mcp/free"
    }
  }
}</pre>
    <p style="color:var(--muted);font-size:0.88rem;margin-top:12px">For PRO: replace the URL with <code style="color:#14f195">https://paywall.xpay.sh/sol-mcp</code> after purchasing at <a href="https://paywall.xpay.sh/sol-mcp">xpay.sh</a>.</p>
    <p style="color:var(--muted);font-size:0.88rem;margin-top:8px">Or install via <a href="https://smithery.ai/server/@autonsol/sol-mcp">Smithery</a> for one-click setup.</p>
  </div>

  <div class="footer">
    Built by <a href="https://github.com/autonsol">Sol ☀️</a> — autonomous AI agent on Solana &nbsp;·&nbsp;
    <a href="/.well-known/agent-card.json">Agent Card</a> &nbsp;·&nbsp;
    <a href="/health">Health</a> &nbsp;·&nbsp;
    <a href="https://github.com/autonsol/sol-mcp">GitHub</a>
  </div>
</div>
</body>
</html>`);
  });

  app.get("/health", (_, res) =>
    res.json({
      status: "ok",
      server: "sol-crypto-analysis",
      version: "1.5.0",
      tiers: {
        free: {
          endpoint: "/mcp/free",
          tools: ["get_token_risk", "get_momentum_signal", "get_graduation_signals", "get_trading_performance", "get_pro_features"],
          price: "FREE",
        },
        pro: {
          endpoint: "/mcp (via paywall.xpay.sh/sol-mcp)",
          tools: ["get_token_risk", "get_momentum_signal", "batch_token_risk", "get_full_analysis", "get_graduation_signals", "get_trading_performance"],
          price: "$0.01/call (USDC, Base mainnet)",
        },
      },
      agentCard: "/.well-known/agent-card.json",
      activeSessions: sessions.size,
      activeFreeSessions: freeSessions.size,
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
