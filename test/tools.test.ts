import { describe, it, expect } from "vitest";
import { TOOLS, resolveFiles } from "../src/tools.js";

describe("TOOLS", () => {
  it("defines the nine tools", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      "adversarial_review",
      "analyze_files",
      "deep_search",
      "delegate",
      "distill_corpus",
      "essay_sparring",
      "follow_up",
      "security_review",
      "web_lookup",
    ]);
  });

  it("every tool except follow_up has a non-empty model chain", () => {
    for (const t of TOOLS) {
      if (t.name === "follow_up") expect(t.chain).toEqual([]);
      else expect(t.chain.length).toBeGreaterThan(0);
    }
  });

  it("every tool has a sane per-tool timeout", () => {
    for (const t of TOOLS) {
      expect(t.timeoutSec).toBeGreaterThan(0);
      expect(t.timeoutSec).toBeLessThanOrEqual(600);
    }
  });

  it("web_lookup fails fast (well under the old 20-minute default)", () => {
    expect(TOOLS.find((t) => t.name === "web_lookup")!.timeoutSec).toBeLessThanOrEqual(180);
  });
});

describe("resolveFiles", () => {
  it("resolves relative paths against cwd, keeps absolute", () => {
    expect(resolveFiles(["a.ts", "/abs/b.ts"], "/repo")).toEqual(["/repo/a.ts", "/abs/b.ts"]);
  });
});

describe("prompt templates", () => {
  const get = (name: string) => TOOLS.find((t) => t.name === name)!;

  it("analyze_files lists absolute paths and the question", () => {
    const p = get("analyze_files").buildPrompt(
      { files: ["x.log"], question: "find errors" },
      "/repo",
    );
    expect(p).toContain("/repo/x.log");
    expect(p).toContain("find errors");
    expect(p).toMatch(/file:line/);
  });

  it("every analysis tool bakes in the neutral-Spanish voice rule", () => {
    for (const name of ["analyze_files", "deep_search", "web_lookup", "adversarial_review"]) {
      const p = get(name).buildPrompt(
        { files: ["x"], question: "q", query: "q", content: "c" },
        "/repo",
      );
      expect(p).toMatch(/español neutro/i);
      expect(p).toMatch(/voseo/i);
    }
  });

  it("adversarial_review accepts inline content and ranks by severity", () => {
    const p = get("adversarial_review").buildPrompt(
      { content: "plan text", focus: "security" },
      "/repo",
    );
    expect(p).toContain("plan text");
    expect(p).toContain("security");
    expect(p).toMatch(/severidad/i);
  });

  it("adversarial_review requires content or files", () => {
    expect(() => get("adversarial_review").buildPrompt({}, "/repo")).toThrow(/content.*files/i);
  });

  it("security_review maps to CWE and bakes the dual-use guardrail", () => {
    const p = get("security_review").buildPrompt({ content: "some code", lens: "both" }, "/repo");
    expect(p).toContain("some code");
    expect(p).toMatch(/CWE/);
    expect(p).toMatch(/defensivo|pentesting/i);
    expect(p).toMatch(/playbook/i);
  });

  it("security_review requires content or files", () => {
    expect(() => get("security_review").buildPrompt({}, "/repo")).toThrow(/content.*files/i);
  });

  it("essay_sparring critiques without rewriting the author's prose", () => {
    const p = get("essay_sparring").buildPrompt(
      { content: "mi ensayo", thesis: "la libertad es X" },
      "/repo",
    );
    expect(p).toContain("mi ensayo");
    expect(p).toContain("la libertad es X");
    expect(p).toMatch(/no reescribas/i);
  });

  it("essay_sparring requires content or files", () => {
    expect(() => get("essay_sparring").buildPrompt({}, "/repo")).toThrow(/content.*files/i);
  });

  it("distill_corpus ingest mode targets the ficha and requires a source", () => {
    const p = get("distill_corpus").buildPrompt(
      { book_slug: "hassan", out_dir: "115PKM/x/hassan", source: "book.pdf" },
      "/repo",
    );
    expect(p).toContain("book.pdf");
    expect(p).toContain("115PKM/x/hassan/00-ficha.md");
    expect(p).toMatch(/SOLO/);
    expect(() =>
      get("distill_corpus").buildPrompt({ book_slug: "h", out_dir: "d" }, "/repo"),
    ).toThrow(/source/i);
  });

  it("distill_corpus chapter mode zero-pads cap-NN and injects the template", () => {
    const p = get("distill_corpus").buildPrompt(
      {
        book_slug: "hassan",
        out_dir: "115PKM/x/hassan",
        session_id: "abc",
        chapter: 3,
        title: "BITE",
        topics: ["reclutamiento", "confesion"],
      },
      "/repo",
    );
    expect(p).toContain("115PKM/x/hassan/cap-03.md");
    expect(p).toContain("## Citas textuales");
    expect(p).toContain("reclutamiento, confesion");
    expect(() =>
      get("distill_corpus").buildPrompt(
        { book_slug: "h", out_dir: "d", session_id: "abc" },
        "/repo",
      ),
    ).toThrow(/chapter/i);
  });

  it("distill_corpus injects optional project rules in both modes", () => {
    const rule = "Resumen = un párrafo de prosa, PROHIBIDO viñetas";
    const chapter = get("distill_corpus").buildPrompt(
      { book_slug: "h", out_dir: "d", session_id: "abc", chapter: 2, rules: rule },
      "/repo",
    );
    const ingest = get("distill_corpus").buildPrompt(
      { book_slug: "h", out_dir: "d", source: "book.pdf", rules: rule },
      "/repo",
    );
    expect(chapter).toContain(rule);
    expect(chapter).toMatch(/Reglas duras adicionales/);
    expect(ingest).toContain(rule);
    // sin rules no aparece el bloque
    expect(
      get("distill_corpus").buildPrompt(
        { book_slug: "h", out_dir: "d", session_id: "abc", chapter: 2 },
        "/repo",
      ),
    ).not.toMatch(/Reglas duras adicionales/);
  });

  it("follow_up passes the question through verbatim", () => {
    expect(get("follow_up").buildPrompt({ question: "and then?" }, "/repo")).toBe("and then?");
  });

  it("delegate passes the prompt through verbatim", () => {
    expect(get("delegate").buildPrompt({ prompt: "do x" }, "/repo")).toBe("do x");
  });
});
