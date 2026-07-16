# FORK.md — agy-bridge-fennek

Fine-tuned fork of [**agy-bridge**](https://github.com/sshahzaiib/agy-bridge) by
[sshahzaiib](https://github.com/sshahzaiib) (MIT). All upstream architecture, model
routing, quota failover, and timeout handling are unchanged. This fork **only tunes what
the tools tell `agy`**, retunes a couple of model chains, and adds three domain tools —
so the orchestrating Claude gets answers already conformant to this project's voice and
domains, without reformatting.

It runs **locally** (not published to npm). The MCP client points at
`node <repo>/dist/index.js` instead of `npx -y agy-bridge`.

## What changed vs upstream

### 1. Voice baked into every delegation (`src/tools.ts`)

The upstream `OUTPUT_RULES` was one English, code-centric line. Replaced with layered
constants injected into every analysis tool:

- **`VOICE`** — Spanish _neutro internacional_, **no voseo** (`vos/tenés/che`…), sober
  report register (≤1 adjective per noun, no synonym chains), keep security terms of art
  in English + italics + one gloss (never calqued), and **never rewrite the author's
  prose** — critique, don't replace.
- **`DENSE`** — direct, no preamble/closing, dense actionable conclusions (not dumps),
  cite the source of every claim (`file:line` for code, page/chapter/URL otherwise).
- **`SECURITY_GUARDRAIL`** — dual-use line: analysis stays at defensive / authorized-
  testing altitude; no operational offensive playbooks, weapons, or lethal-harm steps.

### 2. Model chains retuned

- `analyze_files`: **Pro (High) → Flash (High)** (was Flash→Pro-Low). Security/binary
  triage rewards correctness.
- `delegate`: **Pro (High) → Flash (High)** (was Flash only).
- `adversarial_review`: unchanged (Pro High → Opus 4.6 → Flash High).
- `web_lookup`, `deep_search`: kept cheap-first (Flash).

### 3. Three new domain tools

| Tool              | Purpose                                                                                                                                                                                                                                                                                   | Chain                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `security_review` | Red+blue security audit: CWE/CVE/ATT&CK mapping, exploitability×impact ranking, detection+mitigation per finding. Dual-use guardrail baked in.                                                                                                                                            | Pro High → Opus 4.6 → Flash High |
| `essay_sparring`  | Adversarial critique of a philosophical/technical essay draft — weak premises, non-sequiturs, ignored counterarguments. **Critiques, never rewrites.**                                                                                                                                    | Opus 4.6 → Pro High              |
| `distill_corpus`  | Distill a book/PDF into the RAG-lite base (one md/chapter + index) per the `destilar-corpus` method. Two modes via `session_id`: ingest (writes `00-ficha.md`, returns chapter list) / chapter (writes `cap-NN.md` from the ingested session). agy writes to disk; returns only the path. | Pro High → Flash High            |

## Rebuild / test

```bash
npm install
npm run typecheck && npm test && npm run build
```

The MCP entry uses the committed `dist/index.js`, so **rebuild after editing `src/`**.

## Upstream sync

`origin` is this fork. To pull upstream changes:

```bash
git remote add upstream https://github.com/sshahzaiib/agy-bridge.git   # once
git fetch upstream && git merge upstream/main   # resolve conflicts in src/tools.ts
```
