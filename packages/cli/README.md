# token2022-preflight

Read-only Token-2022 transfer compatibility diagnostics for Solana.

Token-2022 Preflight inspects a mint and, optionally, a source token account, destination token account, and transfer amount. It reports known blockers, required integration actions, warnings, evidence, and unsupported behavior without signing or sending a transaction.

> This tool is an integration diagnostic, not a security audit or a transfer guarantee.

## Requirements

- Node.js 24 or newer
- Access to a Solana RPC endpoint; public mainnet-beta and devnet endpoints are used by default

## Run with npx

```bash
npx token2022-preflight inspect <MINT_ADDRESS>
```

## Global installation

```bash
npm install --global token2022-preflight
token22 inspect <MINT_ADDRESS>
```

## Transfer inspection

```bash
token22 inspect <MINT_ADDRESS> \
  --cluster mainnet-beta \
  --amount 100 \
  --source <SOURCE_TOKEN_ACCOUNT> \
  --destination <DESTINATION_TOKEN_ACCOUNT>
```

Source and destination must be token-account addresses and must be supplied together.

## Output modes

```bash
token22 inspect <MINT_ADDRESS> --verbose
token22 inspect <MINT_ADDRESS> --json
```

- `--verbose` includes summaries, evidence, and technical details.
- `--json` writes only the versioned JSON report to stdout.

Exit codes are `0` for `READY` or `WARNING`, `2` for `ACTION_REQUIRED`, `3` for `BLOCKED`, `4` for `UNKNOWN`, and `1` for input, RPC, or internal errors.

## RPC configuration

RPC resolution order is `--rpc-url`, `SOLANA_RPC_URL`, then the public endpoint for the selected cluster.

```bash
SOLANA_RPC_URL=https://rpc.example.com token22 inspect <MINT_ADDRESS>
token22 inspect <MINT_ADDRESS> --rpc-url https://rpc.example.com
```

Supported clusters are `mainnet-beta` and `devnet`. The CLI connects directly to RPC and does not depend on the Token-2022 Preflight API, web interface, or Docker services.

## Project

Source, architecture, supported checks, limitations, and contribution instructions are available in the [GitHub repository](https://github.com/amblackrust/token2022-preflight).

## License

[MIT](LICENSE)
