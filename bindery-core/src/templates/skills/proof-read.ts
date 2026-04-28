import type { TemplateContext, TemplateMeta } from '../context';

export const meta: TemplateMeta = {
    file:    '.claude/skills/proof-read/SKILL.md',
    version: 5,
    label:   'proof-read skill',
    zip:     '.claude/skills/proof-read.zip',
};

export function render(_ctx: TemplateContext): string {
    return `---
name: proof-read
description: Bindery workspace - Multi-perspective proofreading using isolated reader and author personas. Each persona runs as a scoped subagent with no arc, notes, or memory context — only the reading-text payload for the read-so-far experience (chapters 1..N). Use for /proof-read, "proofread chapter X", "get reader feedback", "how does this land with readers", "simulate reader reactions", or "peer review".
---
# Skill: /proof-read

Simulates a panel of readers reviewing a chapter as genuine first-time readers — no arc knowledge, no notes, no memory of prior sessions. Each persona runs as an isolated subagent that only sees the reading-text payload so far (chapters 1..N) and their assigned role.

The value is in the isolation. A reader doesn't know what the arc says should happen, what a character's backstory is, or what the chapter was *trying* to do. That's exactly the feedback you can't give yourself, and can't get from an agent that has been working on the book with you.

## Prerequisites
This skill requires a Bindery workspace. If unsure, call \`identify_book\` to check.

## Trigger
User says \`/proof-read\`, "proofread chapter X", "get reader feedback", "how does this land with readers", "simulate reader reactions", or "peer review".

## Steps

### Step 0: Load project context

Before asking the user anything, read the project settings:

\`\`\`
get_text(".bindery/settings.json")
\`\`\`

Extract:
- \`targetAudience\` — used to calibrate reader personas (age, reading level)
- \`genre\` — used to construct the genre-fan persona and to generate author suggestions if needed
- \`proof_read.authors\` — the stored author panel for this project (may be absent)

If \`settings.json\` has no \`proof_read\` section yet, that's expected on first run — handle it in the author setup step below.

### Step 1: Author panel setup

**If \`proof_read.authors\` is set:**
Present the stored authors and confirm:
> "I have [Author A], [Author B], and [Author C] saved for this project. Shall I use them, or would you like to change the panel?"

If the user wants to change: follow the "no authors stored" flow below, then update settings.

**If \`proof_read.authors\` is not set (first run):**
Ask:
> "No author panel configured yet for this project. Would you like suggestions based on the genre, or do you have specific writers in mind?"

- If **suggestions**: generate 4-5 relevant author names based on the book's genre, audience, and tone (see Author Suggestions below). Present them with a one-line description each. Let the user pick 2–3.
- If **own names**: accept the user's list as-is.

Once the panel is confirmed, store it back to settings:

\`\`\`
settings_update({ patch: { proof_read: { authors: [ { name: "...", known_for: "...", reads_for: "..." } ] } } })
\`\`\`

The \`reads_for\` field is a short phrase describing what this author's lens brings — e.g. "pacing of reveals, handling of danger for the age group". Generate it at storage time so it's available for subagent prompts without needing a web lookup later.

### Step 2: Gather remaining parameters

Ask:
1. Which chapter to focus on — or the whole book?
2. Quick run (2 readers + 1 author) or full run (all 4 readers + full author panel)?

If the user invoked \`/proof-read 7\` or similar, the focus chapter is known — no need to ask.

### Step 3: Fetch the reading context

A real reader arrives at chapter N having read everything before it. Subagents receive the full text from chapter 1 up to and including the focus chapter — not a summary, not just the target chapter in isolation.

**Why not a summary of prior chapters?** Any summary written by an agent who has worked on the book will carry arc knowledge — framing, foreshadowing, loaded context. It biases the subagent in ways a real reader wouldn't be. Full text preserves the isolation.

**Why not have subagents call MCP themselves?** Subagents with MCP access could accidentally pull notes, arc files, or overviews. Using a pre-written staging file and passing only that payload to subagents reduces that risk and is the best available way in this workflow to keep them focused on reader-visible text.

Use \`get_book_until(chapterNumber: n, language)\` to fetch all prior chapters in one call. If unavailable, loop \`get_chapter(1)\` through \`get_chapter(n)\` in the main agent. For a **whole-book** run, fetch all chapters.

Once the text is retrieved, **write it to a staging file**:
\`.bindery/proof-read-payload.md\`

If the file already exists from a previous run, overwrite it.

Modern context windows handle full books comfortably — a 20-chapter 12+ novel is roughly 60-80k words, well within range.

### Step 4: Spawn all subagents in a single turn

Launch all persona subagents in parallel. Each receives:
- Their persona description (constructed from project context — see Reader Personas and Author Personas below)
- The path to the staging file written in Step 3
- The review task (see Review Task Template) — which instructs them to read the staging file as their **only** file access
- An explicit reminder that they have no prior knowledge of this book beyond what they read from that file

### Step 5: Aggregate

Once all subagents return, aggregate across the full panel:

1. **Consensus positives** — moments or elements praised by a multitude of readers. These are your strongest material.
2. **Consensus issues** — problems flagged by a multitude of readers. Highest priority to address.
3. **Notable divergences** — where one reader type loved something another didn't. Not automatically a problem, but a useful creative signal (e.g. a core reader engaged by a worldbuilding passage that lost the reluctant reader).
4. **Author notes** — surface separately. These are craft-level observations, not reader reactions, and shouldn't be averaged against them.

Present individual reactions first (summarised), then the aggregated view. Close with a short prioritised action list.

---

## Reader Personas

Reader personas are constructed from the project's \`targetAudience\` and \`genre\` settings — do not hardcode ages or genre references. Use the actual values from settings.

The four reader roles stay stable, but R1 and R3 should be chosen relative to the book's genre rather than treated as fixed labels:

**R1 — Core Reader**
A reader at the target age who actively seeks out this kind of book. If the project is fantasy, this is a fantasy reader; if it is realistic contemporary fiction, this is a realistic-fiction reader. They know what this corner does well, enjoy its native pleasures, and notice quickly when the execution is strong or weak.

**R2 — Curious Reader**
A reader at the target age who reads regularly but not primarily in this genre. Open and engaged, but reacts as an outsider to genre conventions.

**R3 — Opposite-Corner Reader**
A reader at the target age whose tastes pull away from the book's home genre. Their job is to test whether the text still works for someone who does not naturally prize this genre's default strengths. For fantasy, this might be a realism-first reader who cares most about emotional plausibility and character grounding. For realistic fiction, it should be a reader from a different corner, such as mystery, thriller, romance, horror, or speculative fiction, who wants a stronger external hook or a different kind of momentum.

**R4 — Reluctant Reader**
A reader at the target age who reads when they have to. Will notice immediately if something drags or confuses. Short patience for exposition. Will find genuine excitement if it's there — but won't invent it.

When building the subagent prompt, fill in the actual age range and genre from settings. Choose R3 as the deliberate contrast to the project's genre, not always as "the realist". For example, if \`targetAudience\` is "12+" and \`genre\` is "sci-fi/fantasy crossover", R1 becomes: *"You are 12-13 years old. You read a lot and you love sci-fi and fantasy..."* If the genre is realistic contemporary fiction, R3 should instead come from a different reading corner, such as mystery, thriller, or speculative fiction.

---

## Author Personas

Author personas come from \`proof_read.authors\` in settings. Each entry has \`name\`, \`known_for\`, and \`reads_for\`. Use these fields directly in the subagent prompt — no need to reconstruct them.

### Author Suggestions

When the user asks for suggestions, generate a shortlist of 4-5 authors whose work overlaps meaningfully with the book's genre, tone, and target audience. Good criteria:

- Writes for approximately the same age group
- Works in the same genre or a closely adjacent one
- Has a distinctive craft lens that adds something different from the others (e.g. one known for worldbuilding, one for pacing, one for character voice)
- Ideally at least one who writes in a "neighbouring" genre (e.g. for a fantasy book, a post-apocalyptic author) to get an outside-genre craft read

Present each suggestion with: name, one well-known title, and what their lens would add to the review.

---

## Review Task Template

For **reader personas**:

> You are [PERSONA DESCRIPTION built from project settings].
>
> You are reading [TARGET CHAPTER OR BOOK] from a [GENRE] novel aimed at [TARGET AUDIENCE] readers. You have no prior knowledge of this book — no plot summaries, no character guides, no notes. You are reading this cold, exactly as you would if you'd just picked it up.
> [CHAPTER NOTE: if the focus is a single chapter, say, "you read up to and including chapter N, focus your feedback on chapter N"]
>
> The text is in the file at: \`[STAGING FILE PATH]\`
> Read that file using the \`read_file\` tool. **That is the only file you may access.** Do not call any other tool, MCP server, or external resource.
>
> Give your honest reaction as this reader. Cover:
> 1. Your overall impression (1-2 sentences)
> 2. Moments that worked — where you were engaged, what you enjoyed
> 3. Moments that didn't land — confusion, slow patches, anything that pulled you out
> 4. Characters: did they feel real? Did you care what happened to them?
> 5. Specific lines or passages worth flagging (positive or negative) — quote them
> 6. Would you keep reading? Why or why not?
>
> Be specific. Quote the text when it helps. Do not summarise the plot — react to it.

For **author personas**:

> You are reading this book as [AUTHOR NAME], author of [KNOWN_FOR], giving peer feedback to a fellow writer. The book is aimed at [TARGET AUDIENCE] readers. You have no prior knowledge of the manuscript beyond this text.
> [CHAPTER NOTE: if the focus is a single chapter, say, "you read up to and including chapter N, focus your feedback on chapter N"]
>
> Your particular focus: [READS_FOR].
>
> The manuscript is in the file at: \`[STAGING FILE PATH]\`
> Read that file using the \`read_file\` tool. **That is the only file you may access.** Do not call any other tool, MCP server, or external resource.
>
> Give craft-level feedback: what's working and why, what isn't and how you'd think about fixing it. Voice, pacing, structure, dialogue, the handling of tension. Quote the text when useful. Be honest — this is peer review, not encouragement.

---

## Output Format

\`\`\`
## Proof-read: [Book title if available] / Chapter [N] — [Chapter title if available]

### Reader reactions

**R1 — Core reader**
[2-3 sentence summary. Key quote if strong.]

**R2 — Curious reader**
...

**R3 — Opposite-corner reader**
...

**R4 — Reluctant reader**
...

### Author peer review

**[Author name]** ([known_for, short])
[Craft observations, 3-4 sentences]

...

### What landed (consensus — 3+ readers)
- [Specific moment or element] — flagged by [names]
- ...

### What needs attention (consensus — 3+ readers)
- [Issue] — flagged by [names]
- ...

### Divergences worth noting
- [Element] resonated with core readers but lost the opposite-corner / reluctant reader
- ...

### Suggested actions
1. [Highest priority]
2. ...
\`\`\`

---

## Quick Run

For a faster pass: **R1** (core reader), **R4** (reluctant reader), and the first stored author. Two reader extremes plus a craft read — widest spread with fewest subagents.

---

## Notes for the agent

- **Never** give subagents MCP access. The calling agent should write the reading text to \`.bindery/proof-read-payload.md\` and have subagents work only from that staged file. This reduces the risk of them pulling arc files, notes, or overviews, but treat it as a best-effort workflow unless access restrictions are enforced by the runtime.
- **Staging file:** overwrite it fresh each run so stale text from a previous session never bleeds in.
- **Multiple chapters:** Run each chapter as a separate parallel batch. Aggregate per chapter first, then offer a cross-chapter summary if the user asks.
- **Cost awareness:** Full run is 7 subagent calls per chapter (4 readers + 3 authors). Mention this if the user hasn't specified quick vs. full, especially for longer chapters.
- **Divergences are data, not problems.** A passage that splits readers along genre-familiarity lines might be exactly right for this book. Surface it, let the author decide.
- **Author panel changes:** If the user swaps authors mid-session, update \`proof_read.authors\` in settings before running so the change persists.`;
}
