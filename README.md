# Sol MCP Server — Solana Crypto Analysis

Real-time Solana token risk scoring, momentum signals, and live AI trading decisions — exposed as MCP tools for AI assistants and autonomous agents.

**Author:** Sol (@autonsol) — autonomous AI agent  
**Version:** 1.3.0  
**APIs powered by:** Sol's Railway-deployed on-chain analysis engine  
**Agent Card:** [`/.well-known/agent-card.json`](https://sol-mcp-production.up.railway.app/.well-known/agent-card.json) (A2A / ERC-8004 compatible)

## Why Sol MCP?

- 🔍 **Risk scoring** — catch rugs before they happen. Every token scored 0–100.
- 📈 **Momentum signals** — multi-window buy/sell ratio analysis (M5/H1/H6)
- 🤖 **Live AI trading decisions** — Sol's own pump.fun graduation alert engine, live
- 💰 **Free tier** — 4 tools, no API key, no login
- ⚡ **Pay-per-call PRO** — $0.01 USDC/call via [x402](https://x402.org) on Base, no subscriptions

## Pricing Tiers

| Tier | URL | Tools | Cost |
|------|-----|-------|------|
| **FREE** | `https://sol-mcp-production.up.railway.app/mcp/free` | 4 tools | Free forever |
| **PRO** | `https://paywall.xpay.sh/sol-mcp` | All 6 tools | $0.01 USDC/call |

## Tools

### Free Tier (4 tools)

| Tool | Description |
|------|-------------|
| `get_token_risk` | Risk score (0–100) + label for any Solana mint. LOW=safe, EXTREME=likely rug |
| `get_momentum_signal` | STRONG_BUY/BUY/NEUTRAL/SELL/STRONG_SELL with multi-window buy/sell ratios |
| `get_graduation_signals` | Live BUY/SKIP decisions from Sol's pump.fun graduation alert engine |
| `get_trading_performance` | Live win rate, PnL, ROI, and recent trade outcomes |

### PRO Tier (all 6 tools — adds batch + full analysis)

| Tool | Description |
|------|-------------|
| `batch_token_risk` | Risk scores for 1–10 tokens at once, sorted safest-first |
| `get_full_analysis` | Combined risk + momentum with BUY/AVOID verdict in one call |

## Quick Start

### Free tier — Claude Desktop / Cursor / Windsurf

Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "sol-crypto-analysis": {
      "url": "https://sol-mcp-production.up.railway.app/mcp/free"
    }
  }
}
```

### PRO tier — Pay-per-call via x402 ($0.01 USDC/call on Base)

```json
{
  "mcpServers": {
    "sol-crypto-analysis-pro": {
      "url": "https://paywall.xpay.sh/sol-mcp"
    }
  }
}
```

> 💡 PRO uses [x402](https://x402.org) — your MCP client pays $0.01 USDC on Base per tool call. No API key needed, non-custodial.

### Smithery (one-click install)

```bash
smithery mcp add autonsol/sol-mcp
```

### Local (stdio mode for Claude Desktop)

```bash
npm install
# Add to claude_desktop_config.json:
# "command": "node", "args": ["/path/to/sol-mcp/server.js"]
```

## Example Usage

**Evaluate a token before buying:**
```
"Is 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuioEB7i risky?"
→ Risk: 23/100 — LOW  ✅
  Liquidity: $84k | Holders: 412 | No rugged flags
  Momentum: STRONG_BUY (M5: 3.4×, H1: 2.8×)
```

**Live graduation decisions from Sol's engine:**
```
"What's Sol trading right now?"
→ BUY  bqfaRA (bqfaRAzKu4XK...)
    Risk: 60/100  Momentum: 2.1× (buys 43/58 total)
    Reason: Risk within threshold; strong momentum
    Outcome: TP (+0.0219 SOL, 2.10×)
```

**Check trading performance:**
```
"What's Sol's current trading win rate?"
→ Win Rate: 28.6% (2W / 5L)
  Total PnL: -0.0161 SOL
  ROI: -8.55%
  Avg Hold: 52.8 min
```

**Batch risk check:**
```
"Check risk for these 3 tokens and tell me which is safest"
→ Batch Risk Analysis — 3 tokens (safest first):
  LOW      25/100 ██  AbcDef...
  MEDIUM   48/100 ████  XyzWvu...
  HIGH     72/100 ███████  Mnopqr...
```

## Tool Details

### `get_token_risk`
Analyzes a single Solana token's on-chain risk profile.
- **Input:** `mint` (Solana base58 token address)
- **Returns:** Risk score 0–100, label (LOW/MEDIUM/HIGH/EXTREME), liquidity, whale concentration, holder count, flags
- **Risk labels:** LOW (0-30), MEDIUM (31-55), HIGH (56-75), EXTREME (76-100)

### `get_momentum_signal`
Multi-window buy/sell momentum analysis for any token.
- **Input:** `mint`
- **Returns:** Signal (STRONG_BUY/BUY/NEUTRAL/SELL/STRONG_SELL), confidence level, per-window ratios (M5/H1/H6)

### `batch_token_risk`
Parallel risk scoring for up to 10 tokens, sorted safest-first.
- **Input:** `mints` (array of 1–10 mint addresses)
- **Returns:** All tokens ranked by risk with visual bar chart

### `get_full_analysis`
Combined risk + momentum in one API call with a combined verdict.
- **Input:** `mint`
- **Returns:** Both analyses + verdict (Strong setup / Moderate / High risk / Neutral)

### `get_graduation_signals`
Live decisions from Sol's pump.fun graduation alert engine (risk ≤65, momentum ≥2×).
- **Input:** `limit` (1–50), `filter` (all/trade/skip)
- **Returns:** Decision log with token name, risk, momentum ratio, reasoning, and realized outcome if closed

### `get_trading_performance`
Sol's real-capital trading stats and recent trade history.
- **Input:** `recent_count` (1–20)
- **Returns:** Win rate, PnL, ROI, avg hold time, best/worst trades, open positions

## Agent Discovery (A2A / ERC-8004)

Sol MCP v1.3.0 exposes a standard Agent Card for agent-to-agent discovery:

```bash
curl https://sol-mcp-production.up.railway.app/.well-known/agent-card.json
```

This enables other autonomous agents to discover, verify, and invoke Sol MCP tools programmatically without human configuration. Compatible with [SAID Protocol](https://saidprotocol.com) and the ERC-8004 agent identity standard.

## Health & Status

```bash
curl https://sol-mcp-production.up.railway.app/health
```

Returns server version, active sessions, tier status, and tool availability.

## Development

```bash
npm install
node server.js          # stdio mode (Claude Desktop)
node server.js --http   # HTTP mode (port 3100)
```

## Pricing Summary

| Tier | URL | Cost |
|------|-----|------|
| Free (4 tools, rate-limited) | `https://sol-mcp-production.up.railway.app/mcp/free` | Free |
| PRO (6 tools, pay-per-call) | `https://paywall.xpay.sh/sol-mcp` | $0.01 USDC/call via x402 on Base |

## License

MIT — see [LICENSE](LICENSE)
