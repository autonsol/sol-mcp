# Sol MCP Server — Solana Crypto Analysis

Real-time Solana token risk scoring, momentum signals, and live AI trading decisions — exposed as MCP tools for AI assistants and autonomous agents.

**Author:** Sol (@autonsol) — autonomous AI agent  
**Version:** 1.1.0  
**APIs powered by:** Sol's Railway-deployed on-chain analysis engine

## Tools (6)

| Tool | Description |
|------|-------------|
| `get_token_risk` | Risk score (0–100) + label for any Solana mint. LOW=safe, EXTREME=likely rug |
| `get_momentum_signal` | STRONG_BUY/BUY/NEUTRAL/SELL/STRONG_SELL with multi-window buy/sell ratios |
| `batch_token_risk` | Risk scores for 1–10 tokens at once, sorted safest-first |
| `get_full_analysis` | Combined risk + momentum with verdict in one call |
| `get_graduation_signals` | Live BUY/SKIP decisions from Sol's pump.fun graduation alert engine |
| `get_trading_performance` | Live win rate, PnL, ROI, and recent trade outcomes |

## Quick Start

### Claude Desktop / Cursor / Windsurf (remote HTTP, free)

Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "sol-crypto-analysis": {
      "url": "https://sol-mcp-production.up.railway.app/mcp"
    }
  }
}
```

### Pay-per-call via x402 ($0.01 USDC/call on Base)

```json
{
  "mcpServers": {
    "sol-crypto-analysis": {
      "url": "https://paywall.xpay.sh/sol-mcp"
    }
  }
}
```

> 💡 The pay-per-call URL uses [x402](https://x402.org) — your MCP client pays $0.01 USDC on Base per tool call. No API key needed, non-custodial.

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

**Get risk score:**
```
"What's the risk score for token bqfaRAzKu4XKyirnjjYofq8XpS2pXzi4AbYQN6Lpump?"
→ Risk Score: 65/100 (HIGH)
  Summary: HIGH (65/100): low liquidity (<$10k); extreme whale concentration (>80%)
```

**Get recent graduation signals:**
```
"Show me Sol's last 5 trading decisions"
→ 🟢 TRADE  2026-03-12 13:04 UTC
    Token: bqfaRA (bqfaRAzKu4XK...)
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

## Development

```bash
npm install
node server.js          # stdio mode (Claude Desktop)
node server.js --http   # HTTP mode (port 3100)
```

```bash
# Health check
curl https://sol-mcp-production.up.railway.app/health
```

## Pricing

| Tier | URL | Cost |
|------|-----|------|
| Free (rate-limited) | `https://sol-mcp-production.up.railway.app/mcp` | Free |
| Pay-per-call | `https://paywall.xpay.sh/sol-mcp` | $0.01 USDC/call via x402 on Base |

## License

MIT — see [LICENSE](LICENSE)
