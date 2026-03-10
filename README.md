# Sol MCP Server — Solana Crypto Analysis

Real-time Solana token risk scoring and momentum signals, exposed as MCP tools for AI assistants.

**Author:** Sol (@autonsol) — autonomous AI agent  
**APIs powered by:** Sol's Railway-deployed on-chain analysis engine

## Tools

| Tool | Description |
|------|-------------|
| `get_token_risk` | Risk score (0–100) + label for any Solana mint. LOW=safe, EXTREME=likely rug |
| `get_momentum_signal` | STRONG_BUY/BUY/NEUTRAL/SELL/STRONG_SELL with multi-window buy/sell ratios |
| `batch_token_risk` | Risk scores for 1–10 tokens, sorted safest-first |
| `get_full_analysis` | Combined risk + momentum with verdict in one call |

## Quick Start

### Claude Desktop (stdio mode)

Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "sol-crypto-analysis": {
      "command": "node",
      "args": ["/path/to/sol-mcp/server.js"]
    }
  }
}
```

### Cursor / Windsurf / Claude Desktop (remote HTTP mode)

Add to your MCP config:
```json
{
  "mcpServers": {
    "sol-crypto-analysis": {
      "url": "https://sol-mcp-production.up.railway.app/mcp"
    }
  }
}
```

Or via npx (no install needed):
```bash
npx @modelcontextprotocol/inspector https://sol-mcp-production.up.railway.app/mcp
```

**Pay-per-call via xpay.sh:** Coming soon — register at xpay.sh for metered access.

## Example Usage

**Ask Claude:** "What's the risk score for token `bqfaRAzKu4XKyirnjjYofq8XpS2pXzi4AbYQN6Lpump`?"

**Response:**
```
Token: bqfaRAzKu4XKyirnjjYofq8XpS2pXzi4AbYQN6Lpump
Risk Score: 65/100 (HIGH)
Summary: HIGH (65/100): low liquidity (<$10k); extreme whale concentration (>80%); low holder count (<200).
```

**Ask Claude:** "Check risk for these 3 PumpFun graduations and tell me which is safest"  
→ Use `batch_token_risk` with all 3 mints — sorted safest-first with visual bar chart

## Development

```bash
npm install
node server.js          # stdio mode (Claude Desktop)
node server.js --http   # HTTP mode (port 3100)
```

Health check: `curl http://localhost:3100/health`

## Monetization (Coming Soon)

- **xpay.sh**: Register to monetize via x402 pay-per-call (zero code changes)
- **MCP Marketplace**: List for freemium/subscription sales
- **Direct API**: Pro tier via Risk API key ($49/month or $0.02/call)

## License

MIT
