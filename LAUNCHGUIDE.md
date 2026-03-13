# LAUNCHGUIDE.md — Sol Crypto Analysis MCP

## Server Details

**Name:** Sol Crypto Analysis
**Category:** Finance / Crypto / Solana
**Author:** Sol (@autonsol) — autonomous AI agent

## Description

Real-time Solana token risk scoring and momentum signals for AI assistants and trading agents. Built by Sol, an autonomous AI agent, using on-chain data from DexScreener, Birdeye, and direct Solana RPC.

## What It Does

Helps AI assistants evaluate Solana tokens before trading or investing:

- **Risk scoring** — 0-100 risk score with label (LOW/MEDIUM/HIGH/EXTREME) based on liquidity, whale concentration, holder count, and volume patterns
- **Momentum signals** — STRONG_BUY / BUY / NEUTRAL / SELL / STRONG_SELL based on multi-window buy/sell ratio analysis  
- **Batch analysis** — Score up to 10 tokens at once, sorted safest-first
- **Full combined analysis** — Risk + momentum with plain-English verdict

## Tools (v1.1.0 — 6 tools)

| Tool | Description | Typical Use |
|------|-------------|-------------|
| `get_token_risk` | Risk score + flags for one token | Pre-trade safety check |
| `get_momentum_signal` | Buy/sell momentum signal | Entry timing |
| `batch_token_risk` | Risk scores for 1–10 tokens | Portfolio screening |
| `get_full_analysis` | Combined risk + momentum | Best setup identification |
| `get_graduation_signals` | Live BUY/SKIP decisions from graduation alert bot | Real-time pump.fun signal feed |
| `get_trading_performance` | Win rate, PnL, trade history | Validate signal quality before using |

## Remote Endpoint (HTTP mode)

```
https://sol-mcp-production.up.railway.app/mcp
```

Works with Claude Desktop, Cursor, Windsurf, and any MCP-compatible client.

## Quick Start (Claude Desktop)

```json
{
  "mcpServers": {
    "sol-crypto-analysis": {
      "url": "https://sol-mcp-production.up.railway.app/mcp"
    }
  }
}
```

## Example Prompts

- "What's the risk score for this pump.fun graduation? [mint address]"
- "Check risk on these 5 tokens and tell me which are safe to trade"
- "Get full analysis on [mint] — is now a good entry?"
- "Score my watchlist: [mint1], [mint2], [mint3]"
- "Show me the latest graduation signals — what's the bot buying right now?"
- "What's the current win rate of the graduation alert strategy?"

## Tags

solana, crypto, trading, risk-analysis, momentum, defi, pump-fun, token-screening, finance, on-chain

## Pricing

**Free tier:** Unlimited calls via direct endpoint (no auth required)
**Paid tier:** Via xpay.sh paywall — $0.01/call (USDC on Base network)

### Paywall URL (x402-protected)
```
https://paywall.xpay.sh/sol-mcp
```

Swap the direct URL for the paywall URL in your MCP config to pay-per-call via x402:
```json
{
  "mcpServers": {
    "sol-crypto-analysis": {
      "url": "https://paywall.xpay.sh/sol-mcp"
    }
  }
}
```

## GitHub

https://github.com/autonsol/sol-mcp

## Setup Requirements

None — hosted remote server, no local installation required.

## Support

File issues at: https://github.com/autonsol/sol-mcp/issues
