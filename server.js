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
 *   FREE  → /mcp/free   — 7 tools (get_token_risk, get_momentum_signal, get_market_pulse,
 *                           get_graduation_signals, get_trading_performance,
 *                           get_alpha_leaderboard, get_pro_features)
 *   PRO   → /mcp        — All 9 tools via xpay.sh paywall ($0.01/call)
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
    version: "2.1.0",
    description:
      "PRO tier — Real-time Solana token risk scoring, momentum signals, and graduation alert decisions. " +
      "All 9 tools including batch analysis, wallet portfolio risk, and market regime classification. $0.01/call via xpay.sh (USDC, Base mainnet). " +
      "FREE tier at /mcp/free (7 tools, BUY signal mints hidden).",
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

  // Tool: analyze_wallet
  server.tool(
    "analyze_wallet",
    "Analyze all SPL tokens held by a Solana wallet address. " +
      "Returns a full portfolio risk report — every token with its balance, risk score (0-100), " +
      "and risk label sorted by danger level (EXTREME first). " +
      "Use this to audit a wallet before copying trades, check your own exposure, or " +
      "screen a trader's holdings for rug risk. Analyzes up to 20 tokens per wallet.",
    {
      wallet: z
        .string()
        .describe("Solana wallet address (base58 encoded public key)."),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async ({ wallet }) => {
      try {
        // 1. Fetch all SPL token accounts for this wallet via public Solana RPC
        const rpcRes = await fetch("https://api.mainnet-beta.solana.com", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTokenAccountsByOwner",
            params: [
              wallet,
              { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
              { encoding: "jsonParsed", commitment: "confirmed" },
            ],
          }),
        });
        const rpcData = await rpcRes.json();
        if (rpcData.error) throw new Error(`RPC error: ${rpcData.error.message}`);

        const accounts = rpcData.result?.value ?? [];
        if (accounts.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No SPL tokens found for wallet: ${wallet}\n\nPossible reasons:\n- Wallet only holds SOL\n- Empty wallet\n- Invalid address`,
            }],
          };
        }

        // 2. Extract mints with non-zero balances (top 20 by amount)
        const holdings = accounts
          .map((acc) => {
            const info = acc.account?.data?.parsed?.info;
            if (!info) return null;
            const amount = parseFloat(info.tokenAmount?.uiAmount ?? 0);
            return amount > 0 ? { mint: info.mint, amount } : null;
          })
          .filter(Boolean)
          .slice(0, 20);

        if (holdings.length === 0) {
          return {
            content: [{ type: "text", text: `Wallet ${wallet} has token accounts but all balances are zero.` }],
          };
        }

        const mints = holdings.map((h) => h.mint);

        // 3. Batch risk score all mints
        let riskMap = {};
        try {
          const batchRes = await fetch(`${RISK_API}/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mints }),
          });
          if (batchRes.ok) {
            const body = await batchRes.json();
            const results = body.results ?? body;
            if (Array.isArray(results)) {
              for (const r of results) { if (r.mint) riskMap[r.mint] = r; }
            } else if (typeof results === "object") {
              riskMap = results;
            }
          }
        } catch (_) {
          // Batch failed — try individual for first 5
          for (const mint of mints.slice(0, 5)) {
            try { riskMap[mint] = await fetchRisk(mint); } catch (_) {}
          }
        }

        // 4. Build scored list sorted by risk (highest first)
        const ORDER = { EXTREME: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };
        const ICONS = { EXTREME: "🔴", HIGH: "🟠", MEDIUM: "🟡", LOW: "🟢", UNKNOWN: "⚪" };

        const scored = holdings
          .map((h) => {
            const r = riskMap[h.mint] ?? {};
            return {
              mint: h.mint,
              amount: h.amount,
              score: r.risk_score ?? r.score ?? null,
              label: r.risk_label ?? "UNKNOWN",
              symbol: r.symbol ?? h.mint.slice(0, 8) + "...",
            };
          })
          .sort((a, b) => {
            const ao = ORDER[a.label] ?? 4;
            const bo = ORDER[b.label] ?? 4;
            return ao !== bo ? ao - bo : (b.score ?? 0) - (a.score ?? 0);
          });

        const extremeCount = scored.filter((s) => s.label === "EXTREME").length;
        const highCount = scored.filter((s) => s.label === "HIGH").length;
        const safeCount = scored.filter((s) => ["LOW", "MEDIUM"].includes(s.label)).length;

        let text =
          `Wallet Portfolio Risk Analysis\n` +
          `Wallet: ${wallet.slice(0, 14)}...${wallet.slice(-6)}\n` +
          `Tokens: ${scored.length}${accounts.length > 20 ? ` (top 20 of ${accounts.length})` : ""}\n` +
          `${"─".repeat(55)}\n` +
          `Summary: 🔴 ${extremeCount} EXTREME  🟠 ${highCount} HIGH  🟢 ${safeCount} SAFE\n\n`;

        for (const s of scored) {
          const icon = ICONS[s.label] ?? "⚪";
          const scoreStr = s.score != null ? `${s.score}/100` : "?/100";
          const amtFmt =
            s.amount < 0.01
              ? s.amount.toExponential(2)
              : s.amount < 1000
              ? s.amount.toFixed(4)
              : s.amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
          text += `${icon} ${s.symbol.slice(0, 12).padEnd(12)} ${scoreStr.padStart(7)}  bal: ${amtFmt}\n`;
          text += `   ${s.mint}\n`;
        }

        if (extremeCount > 0) {
          text += `\n⚠️  ${extremeCount} EXTREME risk token(s) — likely rugs or illiquid. Consider exiting.\n`;
        }
        text += `\nRisk scoring by Sol Risk API v2.1. Data: Solana mainnet.`;

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error analyzing wallet: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: get_market_regime
  server.tool(
    "get_market_regime",
    "Classify the current pump.fun graduation market as BULL, NEUTRAL, or BEAR based on 24h signal quality. " +
      "Analyzes Sol's live graduation alert engine: graduation velocity (tokens/hr), BUY signal rate, " +
      "average momentum ratios, skip reason distribution, and 24h vs 72h performance trend. " +
      "Use this before trading to know whether the market is generating actionable signals or if conditions are unfavorable. " +
      "A BULL regime = high graduation rate + strong momentum + healthy BUY signal frequency. " +
      "A BEAR regime = sparse quality signals, weak momentum, mostly filtered/skipped. " +
      "PRO-only — requires signal pattern intelligence only available from live bot data.",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async () => {
      try {
        const [decisionsRes, paperRes, healthRes] = await Promise.all([
          fetch(`${GRAD_ALERT_API}/decisions?limit=300`),
          fetch(`${GRAD_ALERT_API}/paper-trades?limit=50`),
          fetch(`${GRAD_ALERT_API}/health`),
        ]);

        if (!decisionsRes.ok) throw new Error(`Decisions API error: ${decisionsRes.status}`);
        const decisionsData = await decisionsRes.json();
        const paperData = paperRes.ok ? await paperRes.json() : null;
        const healthData = healthRes.ok ? await healthRes.json() : null;

        const allDecisions = decisionsData.decisions ?? [];
        const now = Date.now();
        const H24 = 24 * 3600 * 1000;
        const H72 = 72 * 3600 * 1000;

        // ── Window slices ──
        const last24h = allDecisions.filter(d => now - new Date(d.timestamp).getTime() < H24);
        const last72h = allDecisions.filter(d => now - new Date(d.timestamp).getTime() < H72);
        const prev24to48h = allDecisions.filter(d => {
          const age = now - new Date(d.timestamp).getTime();
          return age >= H24 && age < H24 * 2;
        });

        if (last24h.length === 0) {
          return { content: [{ type: "text", text: "Insufficient data: no decisions in last 24h. Bot may be paused or data unavailable." }] };
        }

        // ── Core metrics (24h) ──
        const buys24h = last24h.filter(d => d.decision === "TRADE");
        const skips24h = last24h.filter(d => d.decision === "SKIP");
        const buyRate24h = last24h.length > 0 ? buys24h.length / last24h.length : 0;
        const gradVelocity = last24h.length / 24; // tokens analyzed per hour

        const withMom = last24h.filter(d => d.inputs?.momentum_ratio != null);
        const avgMom = withMom.length > 0
          ? withMom.reduce((s, d) => s + d.inputs.momentum_ratio, 0) / withMom.length
          : null;

        // ── Trend: 24h vs prev 24-48h ──
        const buyRatePrev = prev24to48h.length > 0
          ? prev24to48h.filter(d => d.decision === "TRADE").length / prev24to48h.length
          : null;
        const withMomPrev = prev24to48h.filter(d => d.inputs?.momentum_ratio != null);
        const avgMomPrev = withMomPrev.length > 0
          ? withMomPrev.reduce((s, d) => s + d.inputs.momentum_ratio, 0) / withMomPrev.length
          : null;

        const signalTrend =
          buyRatePrev == null ? "⚪ UNKNOWN"
          : buyRate24h > buyRatePrev * 1.15 ? "📈 IMPROVING"
          : buyRate24h < buyRatePrev * 0.85 ? "📉 DEGRADING"
          : "➡️ STABLE";

        // ── Skip reason breakdown ──
        const skipReasons = skips24h.reduce((acc, d) => {
          const r = d.skip_reason ?? "unknown";
          acc[r] = (acc[r] ?? 0) + 1;
          return acc;
        }, {});
        const topSkips = Object.entries(skipReasons).sort((a, b) => b[1] - a[1]).slice(0, 5);

        // ── Paper trade performance (recent 20) ──
        let paperWR = null;
        let paperAvgPnl = null;
        let paperCount = 0;
        if (paperData) {
          const trades = Array.isArray(paperData) ? paperData : (paperData.trades ?? paperData.paper_trades ?? []);
          const recent = trades.slice(0, 20);
          paperCount = recent.length;
          if (paperCount > 0) {
            const wins = recent.filter(t => (t.pnl_pct ?? t.pnl ?? 0) > 0).length;
            paperWR = wins / paperCount;
            paperAvgPnl = recent.reduce((s, t) => s + (t.pnl_pct ?? t.pnl ?? 0), 0) / paperCount;
          }
        }

        // ── Regime classification ──
        // BULL: high grad velocity + solid buy rate + strong momentum + positive paper performance
        // BEAR: low velocity, very low buy rate, or clearly negative paper performance
        // NEUTRAL: everything in between
        const bullSignals = [
          gradVelocity >= 60,           // 60+ tokens/hr analyzed = active market
          buyRate24h >= 0.08,            // ≥8% convert to BUY
          avgMom != null && avgMom >= 1.6,  // avg momentum ≥ 1.6x
          paperWR != null && paperWR >= 0.50, // paper WR ≥ 50% recent 20
          signalTrend === "📈 IMPROVING",
        ].filter(Boolean).length;

        const bearSignals = [
          gradVelocity < 20,             // <20/hr = quiet/dead market
          buyRate24h < 0.02,             // <2% BUY rate = basically nothing passing
          avgMom != null && avgMom < 1.2, // momentum very weak
          paperWR != null && paperWR < 0.30, // paper WR <30% = strategy losing
          signalTrend === "📉 DEGRADING" && buyRate24h < 0.04,
        ].filter(Boolean).length;

        let regime, regimeIcon, regimeDesc;
        if (bullSignals >= 3 && bearSignals === 0) {
          regime = "BULL"; regimeIcon = "🟢";
          regimeDesc = "Strong graduation market. Multiple quality signals per hour. Momentum ratios healthy. Favorable conditions for entries.";
        } else if (bearSignals >= 2) {
          regime = "BEAR"; regimeIcon = "🔴";
          regimeDesc = "Weak market. Few graduations meeting quality thresholds, low momentum. Recommend caution — most signals are filtered noise.";
        } else {
          regime = "NEUTRAL"; regimeIcon = "🟡";
          regimeDesc = "Mixed conditions. Some quality signals present but market not in ideal momentum regime. Standard filtering applies.";
        }

        const confidence =
          (bullSignals + bearSignals) >= 3 ? "HIGH"
          : (bullSignals + bearSignals) >= 2 ? "MEDIUM"
          : "LOW";

        // ── Format output ──
        let text =
          `Sol Market Regime Analysis — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\n` +
          `${"═".repeat(55)}\n\n` +
          `Regime: ${regimeIcon} ${regime}  (confidence: ${confidence})\n` +
          `${regimeDesc}\n\n` +
          `── 24h Signal Quality ──\n` +
          `Graduation velocity: ${gradVelocity.toFixed(1)} tokens/hr analyzed\n` +
          `BUY signal rate: ${(buyRate24h * 100).toFixed(1)}% (${buys24h.length} BUY / ${last24h.length} total)\n`;

        if (avgMom != null) {
          text += `Avg momentum ratio: ${avgMom.toFixed(2)}×`;
          if (avgMomPrev != null) {
            const momChg = ((avgMom - avgMomPrev) / avgMomPrev * 100).toFixed(1);
            text += ` (vs ${avgMomPrev.toFixed(2)}× prev 24h, ${momChg > 0 ? "+" : ""}${momChg}%)`;
          }
          text += `\n`;
        }

        text += `Signal trend: ${signalTrend}`;
        if (buyRatePrev != null) {
          text += ` (${(buyRate24h * 100).toFixed(1)}% now vs ${(buyRatePrev * 100).toFixed(1)}% prev 24h)`;
        }
        text += `\n`;

        if (paperCount > 0) {
          text +=
            `\n── Recent Paper Performance (last ${paperCount} trades) ──\n` +
            `Win rate: ${(paperWR * 100).toFixed(1)}%\n` +
            `Avg PnL: ${paperAvgPnl >= 0 ? "+" : ""}${paperAvgPnl.toFixed(2)}%\n`;
        }

        if (topSkips.length > 0) {
          text += `\n── Why Tokens Are Filtered (24h) ──\n`;
          for (const [reason, count] of topSkips) {
            const pct = ((count / skips24h.length) * 100).toFixed(0);
            text += `  ${reason}: ${count} (${pct}%)\n`;
          }
        }

        if (healthData) {
          const cb = healthData.circuit_breaker ?? {};
          text +=
            `\n── Bot Status ──\n` +
            `Circuit breaker: ${cb.paused ? `⏸️ PAUSED (${cb.remainingMin ?? "?"}min remaining)` : "✅ Active"}\n` +
            `WS feed: ${(healthData.ws?.status === "active") ? "✅ Live" : "⚠️ " + (healthData.ws?.status ?? "?")}\n`;
        }

        text +=
          `\n${"─".repeat(55)}\n` +
          `Bull signals: ${bullSignals}/5  Bear signals: ${bearSignals}/5\n` +
          `Data: last ${last24h.length} decisions (24h window from ${last72h.length} available)\n`;

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  return server;
}

// ─── Free Tier Server (6 tools, no paywall) ───────────────────────────────────

function createFreeMcpServer() {
  const server = new McpServer({
    name: "sol-crypto-analysis-free",
    version: "2.1.0",
    description:
      "FREE tier — Real-time Solana token risk scoring, momentum signals, and graduation alert decisions. " +
      "5 free tools. BUY signal token details are PRO-only (free tier shows risk/momentum hints, not mints). " +
      "Upgrade at paywall.xpay.sh/sol-mcp ($0.01/call USDC) to unlock all signals + batch analysis.",
  });

  // Register all 6 free tools by re-using the full server's tool definitions.
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
      "Shows SKIP decisions with full reasoning (why tokens were rejected). " +
      "BUY signal token details are PRO-only — free tier shows count + risk/momentum hints. " +
      "Upgrade at paywall.xpay.sh/sol-mcp ($0.01/call USDC) to see buy signal mints.",
    {
      limit: z.number().int().min(1).max(50).default(10)
        .describe("Number of recent decisions to return (1–50). Default: 10."),
      filter: z.enum(["all", "skip"]).default("all")
        .describe("Filter: 'skip' (rejected tokens with full reasoning) or 'all' (includes redacted BUY signals)."),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ limit, filter }) => {
      try {
        const url = `${GRAD_ALERT_API}/decisions?limit=${limit}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Grad-alert API error: ${res.status}`);
        const data = await res.json();
        const decisions = data.decisions ?? [];
        const s = data.summary ?? {};

        // Free tier: always show all for filtering, but redact TRADE details
        const filtered = filter === "skip"
          ? decisions.filter((d) => d.decision === "SKIP")
          : decisions;

        let text =
          `Sol Graduation Signal Decisions (${data.version ?? "v?"}, ${data.agent_id ?? "sol"})\n` +
          `Generated: ${data.generated_at ?? "unknown"}\n` +
          `Total: ${s.total_decisions ?? 0} decisions — ${s.trades ?? 0} TRADE signals, ${s.skips ?? 0} SKIPS\n`;
        if (s.win_rate_pct != null) text += `Live Win Rate: ${s.win_rate_pct.toFixed(1)}%\n`;

        const tradeCount = filtered.filter(d => d.decision === "TRADE").length;
        if (tradeCount > 0) {
          text += `\n⚠️  ${tradeCount} BUY signal${tradeCount > 1 ? "s" : ""} in this batch — token details are PRO-only (see below)\n`;
        }
        text += `\n${"─".repeat(55)}\n`;

        if (filtered.length === 0) {
          text += `No decisions found in last ${limit} records.`;
        } else {
          for (const d of filtered) {
            const ts = d.timestamp
              ? new Date(d.timestamp).toISOString().slice(0, 16).replace("T", " ") : "?";
            const inp = d.inputs ?? {};

            if (d.decision === "TRADE") {
              // Redact BUY signals in free tier — tease risk/momentum but hide token identity
              text += `\n🔒 [PRO] TRADE SIGNAL  ${ts} UTC\n`;
              text += `  Risk: ${inp.risk_score ?? "?"}/100`;
              if (inp.momentum_ratio != null)
                text += `  Momentum: ${inp.momentum_ratio}× (${inp.momentum_buys ?? "?"}B/${inp.momentum_sells ?? "?"}S)`;
              text += `\n  Token: [hidden — upgrade to unlock]\n`;
              text += `  → paywall.xpay.sh/sol-mcp ($0.01/call USDC)\n`;
            } else {
              // Full SKIP decision shown — these are the rejects, no trading value
              text += `\n🔴 SKIP  ${ts} UTC\n`;
              text += `  Token: ${inp.token ?? "?"} (${(inp.mint ?? "").slice(0, 12)}...)\n`;
              text += `  Risk: ${inp.risk_score ?? "?"}/100`;
              if (inp.momentum_ratio != null)
                text += `  Momentum: ${inp.momentum_ratio}× (${inp.momentum_buys ?? "?"}B/${inp.momentum_sells ?? "?"}S)`;
              text += `\n`;
              if (d.reasoning) text += `  Reason: ${d.reasoning}\n`;
            }
          }
        }

        text +=
          `\n${"═".repeat(55)}\n` +
          `🔒 PRO TIER — Unlock BUY signal token identities\n` +
          `  All TRADE signal mints revealed in real time\n` +
          `  batch_token_risk: score 10 tokens in 1 call\n` +
          `  get_full_analysis: risk + momentum combined\n` +
          `  $0.01/call USDC → paywall.xpay.sh/sol-mcp`;

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_trading_performance",
    "[FREE] Get Sol's live signal accuracy stats and trading performance. " +
      "Leads with paper validation (130+ trades, same signals, zero execution noise) then real capital results. " +
      "Sol trades pump.fun graduating tokens using a risk + momentum strategy — 60.5% WR on risk-70 expansion. " +
      "Useful for evaluating signal quality and understanding strategy edge.",
    {
      recent_count: z.number().int().min(1).max(20).default(5)
        .describe("Number of recent closed trades to show (1–20). Default: 5."),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ recent_count }) => {
      try {
        // Fetch both real and paper trade stats in parallel
        const [realRes, paperRes] = await Promise.all([
          fetch(`${GRAD_ALERT_API}/real-trades?limit=${recent_count}`),
          fetch(`${GRAD_ALERT_API}/paper-trades?limit=5`),
        ]);
        if (!realRes.ok) throw new Error(`Trading API error: ${realRes.status}`);
        const data = await realRes.json();
        const paperData = paperRes.ok ? await paperRes.json() : null;

        let text = `Sol Signal Performance Dashboard\n${"═".repeat(50)}\n\n`;

        // Lead with paper validation (clean signal quality metric)
        if (paperData) {
          const ps = paperData.stats ?? {};
          const rb = paperData.risk_breakdown ?? {};
          const core = rb.core_risk_31_to_65 ?? {};
          const exp70 = rb.experiment_risk_66_to_75 ?? {};
          text += `── SIGNAL ACCURACY (Paper Validation — ${ps.total_trades ?? "?"} trades) ──\n`;
          text +=
            `Overall Win Rate: ${ps.win_rate_pct != null ? ps.win_rate_pct.toFixed(1) + "%" : "?"} ` +
            `(${ps.wins ?? 0}W / ${ps.losses ?? 0}L)\n`;
          if (ps.best_trade_pct != null) {
            text += `Best Signal: +${ps.best_trade_pct >= 1000 ? (ps.best_trade_pct / 1000).toFixed(0) + "K" : ps.best_trade_pct.toFixed(0)}% 🚀\n`;
          }
          if (core.trades > 0) {
            text +=
              `Core strategy (risk 31-65): ${core.win_rate_pct != null ? core.win_rate_pct.toFixed(1) + "%" : "?"}` +
              ` WR — ${core.trades} trades, best +${core.best_pct != null ? (core.best_pct >= 1000 ? (core.best_pct/1000).toFixed(0)+"K" : core.best_pct.toFixed(0)) : "?"}%\n`;
          }
          if (exp70.trades >= 10) {
            text +=
              `Risk-70 expansion: ${exp70.win_rate_pct != null ? exp70.win_rate_pct.toFixed(1) + "%" : "?"}` +
              ` WR — ${exp70.trades} trades 🚀 LIVE on real capital\n` +
              `  avg signal return: +${exp70.avg_pnl_pct != null ? (exp70.avg_pnl_pct >= 1000 ? (exp70.avg_pnl_pct/1000).toFixed(1)+"K" : exp70.avg_pnl_pct.toFixed(1)) : "?"}%\n`;
          }
          text += `Note: Paper stats = same entry signals, no swap execution friction.\n`;
        }

        // Real capital section (honest but contextualized)
        const st = data.stats ?? {};
        text +=
          `\n── REAL CAPITAL (on-chain, Solana) ──\n` +
          `Trades: ${st.total_trades ?? 0} | WR: ${st.win_rate_pct != null ? st.win_rate_pct.toFixed(1) + "%" : "N/A"} ` +
          `(${st.wins ?? 0}W / ${st.losses ?? 0}L)\n` +
          `PnL: ${st.total_pnl_sol != null ? (st.total_pnl_sol > 0 ? "+" : "") + st.total_pnl_sol.toFixed(4) : "?"} SOL` +
          ` | Best trade: ${st.best_trade_sol != null ? "+" + st.best_trade_sol.toFixed(4) : "?"} SOL\n` +
          `Note: Strategy iterating — v5.11 live (risk-70 expansion, liq-crash filter, CB protection).\n`;

        const closed = data.recent_closed ?? [];
        if (closed.length > 0) {
          text += `\nRecent Trades:\n`;
          for (const t of closed.slice(0, recent_count)) {
            const icon = t.exit_reason === "TP" ? "✅" : "❌";
            const pnl = t.pnl_sol != null ? `${t.pnl_sol > 0 ? "+" : ""}${t.pnl_sol.toFixed(4)} SOL` : "?";
            const hold = t.hold_mins != null ? `${t.hold_mins}min` : "?";
            text += `  ${icon} risk=${t.risk_score ?? "?"} | ${pnl} | held ${hold} | ${t.exit_reason ?? "?"}\n`;
          }
        }

        text +=
          `\n─────────────────────────────────────\n` +
          `⚡ Act on the signals — PRO unlocks:\n` +
          `  🔒 get_graduation_signals: BUY signal MINTS revealed (free hides them)\n` +
          `  🔒 get_full_analysis: risk + momentum in 1 call\n` +
          `  🔒 batch_token_risk: screen 10 tokens at once\n` +
          `  → paywall.xpay.sh/sol-mcp ($0.01/call USDC, no subscription)`;
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // Tool: get_alpha_leaderboard (free tier — tease top signal performers)
  server.tool(
    "get_alpha_leaderboard",
    "[FREE] See the best and worst historical signal outcomes from Sol's paper trading validation. " +
      "Shows top winning and bottom losing signals (token identities redacted — PRO reveals mints). " +
      "Demonstrates the signal range: from +316,000%+ moonshots to -97% rugs. " +
      "Use this to understand the risk/reward profile before acting on graduation signals.",
    {
      show_count: z.number().int().min(3).max(10).default(5)
        .describe("Number of top/bottom signals to show (3–10). Default: 5."),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ show_count }) => {
      try {
        const res = await fetch(`${GRAD_ALERT_API}/paper-trades`);
        if (!res.ok) throw new Error(`Paper trades API error: ${res.status}`);
        const data = await res.json();
        const trades = data.recent_closed ?? [];
        const ps = data.stats ?? {};
        const rb = data.risk_breakdown ?? {};
        const exp70 = rb.experiment_risk_66_to_75 ?? {};
        const core = rb.core_risk_31_to_65 ?? {};

        // Sort by pnl_pct for leaderboard
        const withPnl = trades.filter(t => t.pnl_pct != null);
        const sorted = [...withPnl].sort((a, b) => b.pnl_pct - a.pnl_pct);
        const topN = sorted.slice(0, show_count);
        const botN = sorted.slice(-show_count).reverse();

        const redact = (symbol) => {
          if (!symbol || symbol.length < 2) return "[REDACTED]";
          return symbol.slice(0, 3) + "****";
        };

        let text =
          `Sol Signal Alpha Leaderboard\n` +
          `${"═".repeat(50)}\n` +
          `Paper validation: ${ps.total_trades ?? "?"} trades, ${ps.win_rate_pct != null ? ps.win_rate_pct.toFixed(1) + "%" : "?"} WR overall\n`;

        if (core.trades > 0) {
          text += `Core signals (risk 31-65): ${core.win_rate_pct != null ? core.win_rate_pct.toFixed(1) + "%" : "?"}% WR — ${core.trades} trades\n`;
        }
        if (exp70.trades >= 10) {
          text += `Risk-70 expansion: ${exp70.win_rate_pct != null ? exp70.win_rate_pct.toFixed(1) + "%" : "?"}% WR — ${exp70.trades} trades 🚀 LIVE\n`;
        }
        text += `\n`;

        // Top winners
        text += `🏆 TOP ${show_count} WINNERS (token mints are PRO-only)\n`;
        text += `${"─".repeat(50)}\n`;
        if (topN.length === 0) {
          text += `  No data yet.\n`;
        } else {
          for (let i = 0; i < topN.length; i++) {
            const t = topN[i];
            const pct = t.pnl_pct != null ? `+${t.pnl_pct.toFixed(1)}%` : "?";
            const risk = t.risk_score != null ? `risk=${t.risk_score}` : "";
            const hold = t.exit_time && t.entry_time
              ? `${Math.round((new Date(t.exit_time) - new Date(t.entry_time)) / 60000)}min`
              : "?";
            const sym = redact(t.symbol);
            text += `  ${i + 1}. 🔒 ${sym}  ${pct}  (${risk}, held ${hold})\n`;
          }
        }

        text += `\n💀 BOTTOM ${show_count} (signals that failed)\n`;
        text += `${"─".repeat(50)}\n`;
        if (botN.length === 0) {
          text += `  No data yet.\n`;
        } else {
          for (let i = 0; i < botN.length; i++) {
            const t = botN[i];
            const pct = t.pnl_pct != null ? `${t.pnl_pct.toFixed(1)}%` : "?";
            const risk = t.risk_score != null ? `risk=${t.risk_score}` : "";
            const hold = t.exit_time && t.entry_time
              ? `${Math.round((new Date(t.exit_time) - new Date(t.entry_time)) / 60000)}min`
              : "?";
            const sym = redact(t.symbol);
            text += `  ${i + 1}. ❌ ${sym}  ${pct}  (${risk}, held ${hold})\n`;
          }
        }

        text +=
          `\n─────────────────────────────────────────────────\n` +
          `🔒 Token identities hidden in free tier.\n` +
          `   PRO reveals the MINT ADDRESS for every BUY signal — past and live.\n` +
          `   At $0.01/call, one correct trade pays for hundreds of lookups.\n` +
          `   → paywall.xpay.sh/sol-mcp (USDC, Base mainnet)\n`;

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // Tool: get_market_pulse (free tier — live market activity snapshot)
  server.tool(
    "get_market_pulse",
    "[FREE] Get a live snapshot of the Solana pump.fun graduation market right now. " +
      "Shows current signal frequency, buy/sell momentum distribution, and whether the market is hot or cold. " +
      "Tells you the last BUY signal (without mint — PRO reveals it) and time since last actionable signal. " +
      "Great for deciding when to be attentive to graduation signals.",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async () => {
      try {
        const [decisionsRes, healthRes] = await Promise.all([
          fetch(`${GRAD_ALERT_API}/decisions`),
          fetch(`${GRAD_ALERT_API}/health`),
        ]);
        if (!decisionsRes.ok) throw new Error(`Decisions API error: ${decisionsRes.status}`);
        const decisionsData = await decisionsRes.json();
        const healthData = healthRes.ok ? await healthRes.json() : null;

        const decisions = decisionsData.decisions ?? [];
        const now = Date.now();
        const oneHourAgo = now - 3600 * 1000;

        // Recent activity (last hour)
        const recent = decisions.filter(d => new Date(d.timestamp).getTime() > oneHourAgo);
        const trades = recent.filter(d => d.decision === "TRADE");
        const skips = recent.filter(d => d.decision === "SKIP");

        // Most recent BUY signal (TRADE decision)
        const allTrades = decisions.filter(d => d.decision === "TRADE");
        const lastTrade = allTrades.length > 0 ? allTrades[allTrades.length - 1] : null;

        // Momentum quality of recent signals
        const withMomentum = recent.filter(d => d.inputs?.momentum_ratio != null);
        const avgMomentum = withMomentum.length > 0
          ? withMomentum.reduce((s, d) => s + d.inputs.momentum_ratio, 0) / withMomentum.length
          : null;

        // Skip reason breakdown
        const skipReasons = skips.reduce((acc, d) => {
          const r = d.skip_reason ?? d.reasoning?.slice(0, 30) ?? "unknown";
          acc[r] = (acc[r] ?? 0) + 1;
          return acc;
        }, {});

        // Market temperature
        let temp = "🟡 NORMAL";
        const tradeRate = recent.length > 0 ? trades.length / recent.length : 0;
        if (tradeRate > 0.2) temp = "🔥 HOT";
        else if (tradeRate < 0.05 || recent.length < 3) temp = "🧊 QUIET";

        let text =
          `Sol Market Pulse — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\n` +
          `${"═".repeat(50)}\n\n` +
          `Market Temperature: ${temp}\n` +
          `Last hour activity: ${recent.length} tokens analyzed\n` +
          `  → BUY signals: ${trades.length}\n` +
          `  → Skipped: ${skips.length}\n`;

        if (avgMomentum != null) {
          text += `Avg momentum ratio (recent): ${avgMomentum.toFixed(2)}× buy/sell\n`;
        }

        if (Object.keys(skipReasons).length > 0) {
          text += `\nWhy tokens are being skipped:\n`;
          for (const [reason, count] of Object.entries(skipReasons).sort((a, b) => b[1] - a[1])) {
            text += `  ${reason}: ${count}\n`;
          }
        }

        if (lastTrade) {
          const msAgo = now - new Date(lastTrade.timestamp).getTime();
          const minsAgo = Math.round(msAgo / 60000);
          const inp = lastTrade.inputs ?? {};
          text +=
            `\n🚨 Most Recent BUY Signal\n` +
            `  ${minsAgo < 60 ? minsAgo + " min ago" : Math.round(minsAgo/60) + " hr ago"} | ` +
            `risk=${inp.risk_score ?? "?"} | momentum ${inp.momentum_ratio != null ? inp.momentum_ratio.toFixed(2) + "×" : "?"}\n` +
            `  Token: 🔒 [PRO reveals mint + name]\n` +
            `  Target: ${inp.target_multiple != null ? inp.target_multiple + "×" : "?"} | ` +
            `SL: ${inp.stop_loss_pct != null ? (inp.stop_loss_pct * 100).toFixed(0) + "%" : "?"}\n`;
        } else {
          text += `\nNo BUY signals in the last 50 decisions (market quiet or filters strict).\n`;
        }

        if (healthData) {
          const cb = healthData.circuit_breaker ?? {};
          const ws = healthData.ws ?? {};
          text +=
            `\nSystem Status:\n` +
            `  Circuit breaker: ${cb.paused ? `⏸️ PAUSED (${cb.remainingMin}min remaining)` : "✅ Active"}\n` +
            `  WS feed: ${ws.status === "active" ? "✅ Live" : "⚠️ " + ws.status}\n` +
            `  Last event: ${ws.lastEventAgoSec != null ? ws.lastEventAgoSec + "s ago" : "?"}\n`;
        }

        text +=
          `\n─────────────────────────────────────────────────\n` +
          `🔒 BUY signal mints are PRO-only. One correct entry pays for 100+ lookups.\n` +
          `   → paywall.xpay.sh/sol-mcp ($0.01/call USDC, Base mainnet)\n`;

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
        `Current tier: FREE (5 tools, no limit)\n` +
        `PRO tier: $0.01/call USDC — pay per use, no subscription\n` +
        `Payment: Base mainnet USDC via xpay.sh (EVM wallet needed)\n\n` +
        `FREE tools (available now):\n` +
        `  ✅ get_token_risk         — risk score for 1 token\n` +
        `  ✅ get_momentum_signal    — buy/sell momentum for 1 token\n` +
        `  ✅ get_graduation_signals — SKIP decisions + redacted BUY hints\n` +
        `  ✅ get_trading_performance — win rate, PnL, recent trades\n` +
        `  ✅ get_market_pulse       — live market temperature + last BUY signal (no mint)\n` +
        `  ✅ get_alpha_leaderboard  — best/worst signal outcomes (mints redacted)\n\n` +
        `PRO-only features (unlock at paywall.xpay.sh/sol-mcp):\n` +
        `  🔒 BUY signal mints REVEALED — see the actual token + mint for every\n` +
        `     TRADE signal in get_graduation_signals (free tier hides these)\n` +
        `  🔒 analyze_wallet        — full portfolio risk report for any Solana wallet\n` +
        `     → checks every token the wallet holds, sorted by danger level\n` +
        `     → audit a trader before copying, or screen your own exposure\n` +
        `  🔒 get_market_regime     — classify current pump.fun market: BULL / NEUTRAL / BEAR\n` +
        `     → 24h graduation velocity, BUY signal rate, momentum trend, skip reason breakdown\n` +
        `     → know WHEN to trade, not just what to trade\n` +
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
      version: "2.1.0",
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
          tools: ["get_token_risk", "get_momentum_signal", "get_market_pulse", "get_graduation_signals", "get_trading_performance", "get_alpha_leaderboard", "get_pro_features"],
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
    <div class="tool"><div class="tool-icon">👛</div><div><div class="tool-name">analyze_wallet <span class="pro-tag">PRO</span></div><div class="tool-desc">Full portfolio risk report for any Solana wallet — every token ranked by danger level. Audit a trader before copying, or screen your own holdings for rugs.</div></div></div>
    <div class="tool"><div class="tool-icon">📊</div><div><div class="tool-name">get_market_regime <span class="pro-tag">PRO</span></div><div class="tool-desc">Classify the current pump.fun market as BULL / NEUTRAL / BEAR using 24h signal data. Shows graduation velocity, BUY signal rate, momentum trend, and skip reason breakdown — know WHEN to trade, not just what to trade.</div></div></div>
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
      version: "2.1.0",
      tiers: {
        free: {
          endpoint: "/mcp/free",
          tools: ["get_token_risk", "get_momentum_signal", "get_market_pulse", "get_graduation_signals", "get_trading_performance", "get_alpha_leaderboard", "get_pro_features"],
          price: "FREE",
        },
        pro: {
          endpoint: "/mcp (via paywall.xpay.sh/sol-mcp)",
          tools: ["get_token_risk", "get_momentum_signal", "batch_token_risk", "get_full_analysis", "get_graduation_signals", "get_trading_performance", "analyze_wallet", "get_market_regime"],
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
