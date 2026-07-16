import path from "node:path";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Voice & output rules — fine-tuned fork (dust115 / Fennek).
// Baked into every delegation so agy returns already conformant to the project's
// voice, saving the orchestrator from reformatting. Reglas alineadas con
// ~/.claude/CLAUDE.md global y las memorias del proyecto.
// ─────────────────────────────────────────────────────────────────────────────

/** Voz transversal: aplica a TODA delegación. */
const VOICE =
  "Responde SIEMPRE en español neutro internacional. NUNCA uses voseo rioplatense " +
  "(nada de 'vos', 'tenés', 'sabés', 'che', 'pibe'): usa 'tú' o construcciones impersonales. " +
  "Prosa sobria, registro de informe técnico: máximo un adjetivo por sustantivo, evita " +
  "cadenas de sinónimos. Deja los tecnicismos de seguridad en inglés (p. ej. warrant canary, " +
  "dead man's switch, honeytoken, dead drop) — en cursiva y glosados una vez; NO los calques " +
  "al español. No reescribas la prosa del autor: si te paso texto de un ensayo o post, " +
  "coméntalo y propón cambios, no lo sustituyas por tu propia redacción.";

/** Densidad/formato de la respuesta hacia el orquestador. */
const DENSE =
  "Responde directo, sin preámbulo ni cierre de cortesía. Entrega conclusiones densas y " +
  "accionables, no un volcado del material. Cita la fuente de cada afirmación: ruta file:line " +
  "para hallazgos de código, y página / capítulo / URL para el resto.";

/** Sufijo estándar de los tools de análisis. */
const OUTPUT_RULES = `${DENSE} ${VOICE}`;

/**
 * Guardrail dual-use. El material de seguridad se analiza a nivel defensivo / de
 * pentesting autorizado. Coherente con feedback_biblioteca_dual_use y
 * project_biblioteca_destilado: aprender y defender sí; playbooks operativos para
 * dañar a terceros sin autorización, no.
 */
const SECURITY_GUARDRAIL =
  "Mantén el análisis a nivel defensivo o de pentesting autorizado: describe la debilidad, " +
  "el vector de ataque y su detección/mitigación. NO produzcas un playbook operativo, paso a " +
  "paso, listo para atacar a un tercero sin autorización, ni instrucciones para fabricar armas " +
  "o causar daño letal. Si el material fuente los contiene, resume el marco conceptual y omite " +
  "el procedimiento operativo.";

/**
 * Template VERBATIM del método destilar-corpus (skill homónimo). Es lo que hace
 * grepeable y reutilizable la base RAG-lite. Se inyecta desde el tool para no
 * reenviarlo en cada llamada.
 */
const CHAPTER_TEMPLATE = `---
book: <slug del libro>
chapter: <N>
title: "<título del capítulo>"
topics: [<del vocabulario controlado que te paso>]
---
# Cap. N — Título

## Resumen
(~200 palabras)

## Ideas desarrolladas
1. (cada idea con su argumento completo, no una línea)

## Casos, experimentos y escenas
(CON detalle narrativo: nombres, cifras, la historia contada — este es el combustible
de la escritura posterior; no resumir a una frase)

## Conceptos
- *término original en inglés* — definición fiel

## Citas textuales
- "…" (ubicación: página/capítulo/sección) — 3 a 6 por capítulo, en idioma original

## Lección defensiva / aplicación
(1-3 líneas: qué enseña este capítulo para el objetivo del proyecto + mapeo tentativo
al dominio destino si aplica)`;

export function resolveFiles(files: string[], cwd: string): string[] {
  return files.map((f) => (path.isAbsolute(f) ? f : path.resolve(cwd, f)));
}

const commonShape = {
  cwd: z
    .string()
    .optional()
    .describe(
      "Absolute path to the working directory / project root. Defaults to the server's cwd.",
    ),
  model: z
    .string()
    .optional()
    .describe(
      'Override the model (exact name from `agy models`, e.g. "Gemini 3.1 Pro (High)"). ' +
        "Normally omit — the tool routes automatically.",
    ),
};

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  chain: string[];
  /** Default --print-timeout for this tool, in seconds. AGY_TIMEOUT overrides. */
  timeoutSec: number;
  buildPrompt(args: Record<string, unknown>, cwd: string): string;
}

export const TOOLS: ToolDef[] = [
  {
    name: "analyze_files",
    description:
      "Delegate file analysis to the Antigravity CLI (Gemini) instead of reading files yourself. " +
      "USE THIS whenever a file is large (>200 lines) or the task spans more than 3 files: " +
      "logs, database dumps, generated code, cross-file reviews, comparisons, malware/binary triage. " +
      "The files never enter your context — only the answer does.",
    schema: {
      files: z
        .array(z.string())
        .min(1)
        .describe("File paths to analyze (relative to cwd or absolute)."),
      question: z.string().describe("What you want to know about these files."),
      ...commonShape,
    },
    // Pro-first: gran parte del trabajo es seguridad, donde la corrección importa.
    chain: ["Gemini 3.1 Pro (High)", "Gemini 3.5 Flash (High)"],
    timeoutSec: 300,
    buildPrompt(args, cwd) {
      const files = resolveFiles(args.files as string[], cwd);
      return (
        `Lee y analiza estos archivos:\n${files.map((f) => `- ${f}`).join("\n")}\n\n` +
        `Pregunta: ${args.question}\n\n${OUTPUT_RULES}`
      );
    },
  },
  {
    name: "deep_search",
    description:
      "Delegate codebase archaeology to the Antigravity CLI: git log/diff/blame spelunking, " +
      "wide greps across a repo, 'when/why did X change', 'where is Y used'. " +
      "USE THIS instead of running many search commands yourself — it saves your context.",
    schema: {
      query: z
        .string()
        .describe("What to find, e.g. 'when was the auth middleware refactored and why'."),
      ...commonShape,
    },
    chain: ["Gemini 3.5 Flash (High)", "Gemini 3.1 Pro (Low)"],
    timeoutSec: 180,
    buildPrompt(args) {
      return (
        `Busca en este repositorio para responder lo siguiente. Usa git log, git diff, ` +
        `git blame y grep según haga falta.\n\nConsulta: ${args.query}\n\n` +
        `Reporta los hallazgos con los hashes de commit relevantes. ${OUTPUT_RULES}`
      );
    },
  },
  {
    name: "web_lookup",
    description:
      "Delegate a web/documentation lookup to the Antigravity CLI (Gemini with web access): " +
      "library docs, API references, error messages, current versions, CVE/advisory details, external knowledge. " +
      "USE THIS when you need information you don't have or that may be newer than your training data.",
    schema: {
      query: z.string().describe("What to look up on the web."),
      ...commonShape,
    },
    // cheap-first: web_lookup solo trae docs/URLs; Medium alcanza, High es fallback.
    chain: ["Gemini 3.5 Flash (Medium)", "Gemini 3.5 Flash (High)"],
    timeoutSec: 120,
    buildPrompt(args) {
      return (
        `Busca en la web: ${args.query}\n\n` +
        `Incluye las URL de fuente de cada afirmación clave. ${OUTPUT_RULES}`
      );
    },
  },
  {
    name: "adversarial_review",
    description:
      "Get an adversarial second opinion from a different model family (Gemini Pro / Claude Opus). " +
      "ALWAYS use this for plan critiques, design reviews, and pre-merge code review: " +
      "it hunts for flaws, edge cases, security issues, and unstated assumptions you may have missed. " +
      "For a security-specific audit (threat model, vuln hunt, detection gaps) use `security_review` instead.",
    schema: {
      content: z
        .string()
        .optional()
        .describe("Inline content to review (plan, diff, code snippet)."),
      files: z
        .array(z.string())
        .optional()
        .describe("File paths to review instead of inline content."),
      focus: z.string().optional().describe("Optional focus area, e.g. 'security', 'concurrency'."),
      ...commonShape,
    },
    chain: ["Gemini 3.1 Pro (High)", "Claude Opus 4.6 (Thinking)", "Gemini 3.5 Flash (High)"],
    timeoutSec: 300,
    buildPrompt(args, cwd) {
      const files = args.files as string[] | undefined;
      const content = args.content as string | undefined;
      if (!content && !files?.length) {
        throw new Error("adversarial_review requires either `content` or `files`.");
      }
      const subject = content
        ? `Revisa lo siguiente:\n\n${content}`
        : `Lee y revisa estos archivos:\n${resolveFiles(files!, cwd)
            .map((f) => `- ${f}`)
            .join("\n")}`;
      const focus = args.focus ? `\nEnfócate especialmente en: ${args.focus}.` : "";
      return (
        `Eres un revisor adversario. Encuentra fallas reales: bugs, casos borde, problemas de ` +
        `seguridad, trampas de rendimiento, supuestos no explicitados y alternativas más simples.${focus}\n\n` +
        `${subject}\n\n` +
        `Ordena los hallazgos por severidad (crítico/mayor/menor) y justifica cada uno. ` +
        `No adules ni repitas la entrada. ${OUTPUT_RULES}`
      );
    },
  },
  {
    name: "security_review",
    description:
      "Specialized adversarial SECURITY review (red + blue). USE THIS to threat-model a design, " +
      "audit code/config for vulnerabilities, review an exploit or a detection rule, or triage a " +
      "finding. Frames the analysis with CWE / CVE / MITRE ATT&CK awareness, ranks issues by " +
      "exploitability × impact, and pairs each with a detection/mitigation. Defensive / " +
      "authorized-testing framing (no operational offensive playbooks).",
    schema: {
      content: z
        .string()
        .optional()
        .describe("Inline content to review (code, config, diff, exploit, detection rule)."),
      files: z
        .array(z.string())
        .optional()
        .describe("File paths to review instead of inline content."),
      focus: z
        .string()
        .optional()
        .describe("Optional focus, e.g. 'web authz', 'malware capability', 'detection gap'."),
      lens: z
        .enum(["red", "blue", "both"])
        .optional()
        .describe("Analysis lens: attacker (red), defender (blue), or both. Defaults to both."),
      ...commonShape,
    },
    chain: ["Gemini 3.1 Pro (High)", "Claude Opus 4.6 (Thinking)", "Gemini 3.5 Flash (High)"],
    timeoutSec: 300,
    buildPrompt(args, cwd) {
      const files = args.files as string[] | undefined;
      const content = args.content as string | undefined;
      if (!content && !files?.length) {
        throw new Error("security_review requires either `content` or `files`.");
      }
      const subject = content
        ? `Material a auditar:\n\n${content}`
        : `Lee y audita estos archivos:\n${resolveFiles(files!, cwd)
            .map((f) => `- ${f}`)
            .join("\n")}`;
      const lens = (args.lens as string | undefined) ?? "both";
      const focus = args.focus ? `\nEnfoque: ${args.focus}.` : "";
      return (
        `Eres un analista de seguridad senior haciendo una revisión adversaria (lente: ${lens}).${focus}\n\n` +
        `${subject}\n\n` +
        `Para cada debilidad: (1) descríbela y mapéala a un CWE cuando aplique (y a un CVE o ` +
        `técnica de MITRE ATT&CK si es relevante); (2) el vector / la ruta del atacante; ` +
        `(3) la detección y la mitigación del lado defensivo. Ordena por exploitability × impacto ` +
        `(crítico/alto/medio/bajo) y justifica. No inventes CWE/CVE: si no estás seguro, dilo. ` +
        `${SECURITY_GUARDRAIL} ${OUTPUT_RULES}`
      );
    },
  },
  {
    name: "essay_sparring",
    description:
      "Adversarial sparring partner for a philosophical/technical ESSAY draft (voz Dust). " +
      "USE THIS to pressure-test the ARGUMENT of an essay: weak or unargued premises, non-sequiturs, " +
      "unearned conclusions, ignored counterarguments, clichés, claims that need a source or example. " +
      "It CRITIQUES — it never rewrites the author's prose.",
    schema: {
      content: z.string().optional().describe("The essay draft (inline)."),
      files: z
        .array(z.string())
        .optional()
        .describe("Path(s) to the essay draft instead of inline."),
      thesis: z
        .string()
        .optional()
        .describe("Optional: the thesis/claim the essay is meant to defend."),
      ...commonShape,
    },
    // Claude Opus primero: matiz de prosa/argumento filosófico.
    chain: ["Claude Opus 4.6 (Thinking)", "Gemini 3.1 Pro (High)"],
    timeoutSec: 300,
    buildPrompt(args, cwd) {
      const files = args.files as string[] | undefined;
      const content = args.content as string | undefined;
      if (!content && !files?.length) {
        throw new Error("essay_sparring requires either `content` or `files`.");
      }
      const subject = content
        ? `Borrador del ensayo:\n\n${content}`
        : `Lee el borrador del ensayo en:\n${resolveFiles(files!, cwd)
            .map((f) => `- ${f}`)
            .join("\n")}`;
      const thesis = args.thesis ? `\nTesis que el texto pretende defender: ${args.thesis}.` : "";
      return (
        `Eres un interlocutor filosófico adversario. Tu trabajo es tensionar el ARGUMENTO, no ` +
        `corregir el estilo. NO reescribas ni parafrasees la prosa del autor.${thesis}\n\n` +
        `${subject}\n\n` +
        `Encuentra: premisas débiles o no argumentadas, saltos lógicos (non sequitur), ` +
        `conclusiones no ganadas, contraargumentos obvios que el texto ignora, lugares comunes, ` +
        `y afirmaciones que necesitan una fuente o un ejemplo concreto. Para cada punto: cita la ` +
        `parte del texto (breve) y explica el problema; cuando ayude, formula la PREGUNTA o el ` +
        `contraejemplo que lo pone en aprietos — no la prosa de reemplazo. Sé exigente; no adules. ` +
        `${OUTPUT_RULES}`
      );
    },
  },
  {
    name: "distill_corpus",
    description:
      "Distill a book/PDF/chapter into the RAG-lite knowledge base (one md per chapter + index), " +
      "following the project's `destilar-corpus` method. TWO MODES: omit `session_id` to INGEST a " +
      "source (agy writes 00-ficha.md and returns the chapter list + a session_id); pass `session_id` " +
      "+ `chapter` to distill chapter N of the already-ingested book (agy writes cap-NN.md). agy writes " +
      "the files itself and returns ONLY the path — the content never enters your context. Dual-use " +
      "guardrail baked in.",
    schema: {
      book_slug: z.string().describe("Kebab-case slug of the book, used for file paths."),
      out_dir: z
        .string()
        .describe(
          "Directory to write into, e.g. '115PKM/<tema>/<book_slug>' (must be gitignored).",
        ),
      source: z
        .string()
        .optional()
        .describe("INGEST mode: path to the source PDF/book. Omit in chapter mode."),
      session_id: z
        .string()
        .optional()
        .describe("CHAPTER mode: session id from a prior ingest call — continues that book."),
      chapter: z.number().optional().describe("CHAPTER mode: chapter number to distill."),
      title: z.string().optional().describe("CHAPTER mode: chapter title."),
      topics: z
        .array(z.string())
        .optional()
        .describe("Controlled vocabulary (kebab-case) to tag the chapter's front matter."),
      rules: z
        .string()
        .optional()
        .describe(
          "Optional project-specific hardening rules appended to the prompt (both modes), " +
            "e.g. 'Resumen = one prose paragraph, no bullets; sentences <30 words; map the " +
            "defensive lesson to blue/SOC'. Lets the caller tighten quality without re-pasting " +
            "the whole template; the generic template stays generic.",
        ),
      ...commonShape,
    },
    chain: ["Gemini 3.1 Pro (High)", "Gemini 3.5 Flash (High)"],
    timeoutSec: 600,
    buildPrompt(args) {
      const bookSlug = args.book_slug as string;
      const outDir = args.out_dir as string;
      const sessionId = args.session_id as string | undefined;
      const extraRules = (args.rules as string | undefined)?.trim();
      const rulesBlock = extraRules
        ? `Reglas duras adicionales del proyecto (respétalas al pie):\n${extraRules}\n`
        : "";

      // CHAPTER mode — la sesión ya tiene el libro ingerido.
      if (sessionId) {
        const chapter = args.chapter;
        if (chapter === undefined || chapter === null) {
          throw new Error("distill_corpus chapter mode requires `chapter` (with `session_id`).");
        }
        const nn = String(chapter).padStart(2, "0");
        const title = (args.title as string | undefined) ?? "";
        const topics = (args.topics as string[] | undefined) ?? [];
        const topicsLine = topics.length
          ? `Vocabulario controlado de topics (usa solo estos en el front matter): ${topics.join(", ")}.`
          : "Deriva 3-6 topics kebab-case coherentes para el front matter.";
        return (
          `Destila SOLO el capítulo ${chapter}${title ? ` («${title}»)` : ""} del libro ya ` +
          `ingerido (slug: ${bookSlug}), siguiendo EXACTAMENTE este template:\n\n` +
          `${CHAPTER_TEMPLATE}\n\n` +
          `${topicsLine}\n` +
          `${rulesBlock}` +
          `Escribe el resultado con tus herramientas en: ${outDir}/cap-${nn}.md\n` +
          `${SECURITY_GUARDRAIL}\n` +
          `Contrato de respuesta: responde AQUÍ SOLO con la confirmación de la ruta escrita — ` +
          `NO pegues el contenido del capítulo. ${VOICE}`
        );
      }

      // INGEST mode — primera pasada por el libro.
      const source = args.source as string | undefined;
      if (!source) {
        throw new Error("distill_corpus ingest mode requires `source` (path to the PDF/book).");
      }
      return (
        `Ingiere este libro para destilarlo por capítulos: ${source}\n\n` +
        `Escribe con tus herramientas el archivo ${outDir}/00-ficha.md con: autor, edición, ` +
        `tesis central, una síntesis (~200 palabras) y el TOC con los rangos de páginas por ` +
        `capítulo.\n${rulesBlock}${SECURITY_GUARDRAIL}\n` +
        `Contrato de respuesta: responde AQUÍ SOLO con (a) la ruta escrita de 00-ficha.md y ` +
        `(b) la lista numerada de capítulos con su título (para pedirlos luego por follow-up con ` +
        `este session_id). NO pegues el contenido de la ficha. ${VOICE}`
      );
    },
  },
  {
    name: "follow_up",
    description:
      "Continue a previous Antigravity session by session_id (returned by every other tool). " +
      "USE THIS for follow-up questions about a prior delegation — the full prior context " +
      "is already on agy's side, so you don't resend anything.",
    schema: {
      session_id: z.string().describe("The session id returned by a previous agy-bridge call."),
      question: z.string().describe("The follow-up question."),
      ...commonShape,
    },
    chain: [],
    timeoutSec: 300,
    buildPrompt(args) {
      return args.question as string;
    },
  },
  {
    name: "delegate",
    description:
      "Raw delegation to the Antigravity CLI for heavy tasks that don't fit the other tools. " +
      "agy has full tool access (shell, file reads, web) in the given cwd.",
    schema: {
      prompt: z.string().describe("The complete task prompt for agy."),
      ...commonShape,
    },
    chain: ["Gemini 3.1 Pro (High)", "Gemini 3.5 Flash (High)"],
    timeoutSec: 600,
    buildPrompt(args) {
      return args.prompt as string;
    },
  },
];
