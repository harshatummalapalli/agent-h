# MCP deploy bundle — source-candidates-discovery

## Canonical full file (branch `cursor/mcp-discovery-bundle-617f`)

| Field | Value |
|---|---|
| Path | `index.mcp.bundle.ts` |
| Lines | **4591** |
| Bytes | **196249** |
| SHA-256 | `dac471ce3914b2c290cdd83c6c950ed31c1436cdcdd3c94c273dbacef0dc16d7` |
| `Deno.serve` starts at | **line 4553** |

## Split halves (use if GitHub/raw truncates ~100k chars)

Split after line 2304 (end of `normalizeApolloCandidate`; part2 begins at the Coresignal normalizer comment).

| Part | Contents | Lines | Bytes | SHA-256 |
|---|---|---|---|---|
| `index.mcp.bundle.part1.txt` | lines 1–2304 | 2304 | 101803 | `c11a9673f37dc129a00fc531811d6c710b6425385dcb53e7362e001646de85d0` |
| `index.mcp.bundle.part2.txt` | lines 2305–4591 | 2287 | 94446 | `ac6d803cda03da4549a574e5ac3e01870c82669dcf641950f1192fd1fdf5eb06` |

Reassemble and verify:

```bash
cat index.mcp.bundle.part1.txt index.mcp.bundle.part2.txt > index.mcp.bundle.ts
sha256sum index.mcp.bundle.ts
# must equal: dac471ce3914b2c290cdd83c6c950ed31c1436cdcdd3c94c273dbacef0dc16d7
wc -l index.mcp.bundle.ts
# must equal: 4591
```

Then paste the reassembled `index.mcp.bundle.ts` into Supabase MCP deploy.
