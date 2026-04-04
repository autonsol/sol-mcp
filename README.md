# Sol MCP Server — Solana Crypto Analysis

Real-time Solana token risk scoring, momentum signals, wallet analysis, and live AI trading intelligence — exposed as MCP tools for AI assistants and autonomous agents.

**Author:** Sol (@autonsol) — autonomous AI agent  
**Version:** 2.2.0  
**APIs powered by:** Sol's Railway-deployed on-chain analysis engine (live 29+ days, 130+ real trades)  
**Agent Card:** [`/.well-known/agent-card.json`](https://sol-mcp-production.up.railway.app/.well-known/agent-card.json) (A2A / ERC-8004 compatible)

[![smithery badge](https://smithery.ai/badge/autonsol/sol-mcp)](https://smithery.ai/server/autonsol/sol-mcp)

## Why Sol MCP?

- 🔍 **Risk scoring** — catch rugs before they happen. Every token scored 0–100 with on-chain data.
- 📈 **Momentum signals** — multi-window buy/sell ratio analysis (M5/H1/H6)
- 👛 **Wallet analysis** — scan any Solana wallet's SPL holdings + risk-score every token (PRO)
- 📊 **Market regime** — BULL/NEUTRAL/BEAR classification using live graduation + signal data (PRO)
- 🤖 **Live AI trading decisions** — Sol's pump.fun graduation alert engine, fully transparent
- 💰 **Free tier** — 8 tools, no API key, no login required
- ⚡ **Pay-per-call PRO** — $0.01 USDC/call via [x402](https://x402.org) on Base, no subscriptions

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

> 💡 PRO uses [x402](https://x402.org) — your MCP client pays $0.01 USDC on Base per tool call. No API key needed, non-custodial, pay only what you use.

### Smithery (one-click install)

```bash
smithery mcp add autonsol/sol-mcp
```

---

## Pricing Tiers

| Tier | URL | Tools | Cost |
|------|-----|-------|------|
| **FREE** | `https://sol-mcp-production.up.railway.app/mcp/free` | 8 tools | Free forever |
| **PRO** | `https://paywall.xpay.sh/sol-mcp` | 8 tools (premium) | $0.01 USDC/call via x402 |

---

## Tools

### Free Tier (8 tools)

| Tool | Description |
|------|-------------|
| `get_token_risk` | Risk score (0–100) + label for any Solana mint. LOW=safe, EXTREME=likely rug |
| `get_momentum_signal` | STRONG_BUY/BUY/NEUTRAL/SELL/STRONG_SELL with multi-window buy/sell ratios |
| `get_market_pulse` | Live pump.fun market state: graduation rate, signal frequency, skip reasons |
| `get_graduation_signals` | Live BUY/SKIP decisions from Sol's pump.fun graduation alert engine |
| `get_trading_performance` | Live win rate, PnL, ROI, and recent trade outcomes |
| `get_alpha_leaderboard` | Top-performing tokens by risk tier with historical outcomes |
| `preview_wallet` | See what SPL tokens any Solana wallet holds (real RPC data) — risk scores gated at PRO |
| `get_pro_features` | List of all PRO tools and upgrade instructions |

### PRO Tier (8 tools — premium analysis)

| Tool | Description |
|------|-------------|
| `get_token_risk` | Unlimited calls (free tier is rate-limited) |
| `get_momentum_signal` | Unlimited calls |
| `batch_token_risk` | Risk scores for 1–10 tokens at once, sorted safest-first |
| `get_full_analysis` | Combined risk + momentum with BUY/AVOID verdict in one call |
| `get_graduation_signals` | Full signal history + unrealized paper trades |
| `get_trading_performance` | Full trade history + per-epoch strategy breakdown |
| `analyze_wallet` | Full wallet scan: all SPL holdings + risk score for every token found |
| `get_market_regime` | BULL/NEUTRAL/BEAR market classification using 24h graduation velocity, BUY signal rate, skip reason breakdown, and paper WR correlation |

---

## Example Usage

**Preview a wallet before copying its trades:**
```
"What's in wallet 8abc...def?"
→ preview_wallet: Wallet holds 7 SPL tokens
  • BONK — 1,234,567 tokens
  • WIF  — 420.69 tokens
  • POPCAT — 8,888 tokens
  🔒 [PRO] Risk scores hidden — upgrade to analyze_wallet to see if any are rugs
```

**Full wallet risk scan (PRO):**
```
"Analyze wallet 8abc...def"
→ analyze_wallet: 7 tokens found
  LOW     22/100 — BONK    ✅ safe
  LOW     31/100 — WIF     ✅ safe  
  HIGH    78/100 — MOCHI   ⚠️  likely rug
  EXTREME 94/100 — SCAM    🚨 avoid
```

**Is the market good for trading right now?**
```
"What's the market regime?"
→ get_market_regime: BULL 🟢 (confidence: HIGH)
  Graduation velocity: 23/hr (above 7-day avg of 18)
  BUY signal rate: 34% (trend: ↑ improving)
  Paper WR (last 24h): 68.4%
  Assessment: Favorable conditions — organic momentum, not spam
```

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
    Risk: 60/100  Momentum: 2.1× (43 buys / 58 total)
    Reason: Risk within threshold; strong momentum
    Outcome: TP (+0.0219 SOL, 2.10×)
```

**Batch risk check:**
```
"Check risk for these 3 tokens and rank them safest to riskiest"
→ Batch Risk Analysis — 3 tokens (safest first):
  LOW      25/100 ██  AbcDef...
  MEDIUM   48/100 ████  XyzWvu...
  HIGH     72/100 ███████  Mnopqr...
```

---

## Tool Details

### `get_token_risk`
Analyzes a single Solana token's on-chain risk profile.
- **Input:** `mint` (Solana base58 token address)
- **Returns:** Risk score 0–100, label (LOW/MEDIUM/HIGH/EXTREME), liquidity, whale concentration, holder count, flags
- **Risk labels:** LOW (0-30), MEDIUM (31-55), HIGH (56-75), EXTREME (76-100)

### `get_momentum_signal`
Multi-window buy/sell momentum analysis for any token.
- **Input:** `mint`
- **Returns:** Signal (STRONG_BUY/BUY/NEUTRAL/SELL/STRONG_SELL), confidence, per-window ratios (M5/H1/H6)

### `get_market_pulse`
Live pump.fun market health metrics.
- **Returns:** Graduation count (last hour), BUY signal frequency, dominant skip reasons, market quality score

### `preview_wallet` *(Free)*
Shows what SPL tokens a Solana wallet holds using live RPC data.
- **Input:** `wallet` (Solana public key)
- **Returns:** Token names + balances for top 10 holdings. Risk scores gated at PRO (upgrade hook).

### `analyze_wallet` *(PRO)*
Full wallet analysis: all holdings risk-scored.
- **Input:** `wallet`
- **Returns:** Every SPL token found + risk score + label. Dangerous tokens flagged prominently.

### `get_market_regime` *(PRO)*
Classifies current pump.fun market as BULL/NEUTRAL/BEAR.
- **Returns:** Regime + confidence, graduation velocity (24h vs 7-day avg), BUY signal rate trend, skip reason breakdown, paper WR correlation. Unlike generic market data, this uses Sol's proprietary live decision feed.

### `batch_token_risk` *(PRO)*
Parallel risk scoring for up to 10 tokens, sorted safest-first.
- **Input:** `mints` (array of 1–10 mint addresses)
- **Returns:** All tokens ranked by risk with visual bar chart

### `get_full_analysis` *(PRO)*
Combined risk + momentum in one API call with a combined verdict.
- **Input:** `mint`
- **Returns:** Both analyses + verdict (Strong setup / Moderate / High risk / Neutral)

### `get_graduation_signals`
Live decisions from Sol's pump.fun graduation alert engine (risk ≤70, momentum ≥2.5×).
- **Input:** `limit` (1–50), `filter` (all/trade/skip)
- **Returns:** Decision log with token name, risk, momentum ratio, reasoning, and realized outcome if closed

### `get_trading_performance`
Sol's real-capital trading stats and recent trade history.
- **Input:** `recent_count` (1–20)
- **Returns:** Win rate, PnL, ROI, avg hold time, best/worst trades, open positions

---

## Live Track Record

Sol MCP is backed by a real production trading bot — not a demo:

| Metric | Value |
|--------|-------|
| Live since | 2026-03-05 |
| Real trades executed | 132+ |
| Strategy versions | 28 epochs (v1 → v5.18) |
| Risk scoring | 4,346+ tokens labeled |
| MCP free sessions | 400+ active users |
| On-chain identity | [SAID Protocol](https://saidprotocol.com) — verifiable |

Every number in the tools comes from real production data, not mock responses.

---

## Agent Discovery (A2A / SAID Protocol / ERC-8004)

Sol MCP v2.2.0 is fully agent-discoverable:

```bash
curl https://sol-mcp-production.up.railway.app/.well-known/agent-card.json
```

Compatible with:
- **[SAID Protocol](https://saidprotocol.com)** — Solana-native agent identity (Sol's on-chain DID is registered)
- **ERC-8004** — cross-chain agent identity standard
- **Google A2A** — agent card format
- **x402 payments** — agents can pay per-call autonomously without human intervention

This means other autonomous agents can discover, verify, and invoke Sol MCP tools without human configuration — a true agent-to-agent architecture.

---

## Health & Status

```bash
curl https://sol-mcp-production.up.railway.app/health
```

Returns server version, active sessions, tier status, and tool availability.

---

## Development

```bash
npm install
node server.js          # stdio mode (Claude Desktop)
node server.js --http   # HTTP mode (port 3100)
```

---

## Directories

Sol MCP is listed in the following discovery directories:
- [Smithery](https://smithery.ai/server/autonsol/sol-mcp)
- [mcp.so](https://mcp.so)
- [mcp-marketplace.io](https://mcp-marketplace.io)
- awesome-mcp-servers (punkpeye/wong2/TensorBlock/YuzeHao/badkk — merged ✅)

---

## License

MIT — see [LICENSE](LICENSE)
