import { describe, expect, it } from 'vitest';

import { renderTemplate, type TemplateContext } from '../src/templates';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    title:          'Test Book',
    author:         'Jane Doe',
    description:    'A tale of adventure.',
    genre:          'Fantasy',
    audience:       'middle-grade',
    storyFolder:    'Story',
    notesFolder:    'Notes',
    arcFolder:      'Arc',
    charactersFolder: 'Notes/Characters',
    sessionFile:    'SESSION.md',
    preferencesFile: 'PREFERENCES.md',
    arcGranularity: 'act',
    memoriesFolder: '.bindery/memories',
    languages:      [{ code: 'EN', folderName: 'EN' }],
    langList:       'EN (source)',
    hasMultiLang:   false,
    ...overrides,
  };
}

function makeMultiLangCtx(): TemplateContext {
  return makeCtx({
    languages:    [{ code: 'EN', folderName: 'EN' }, { code: 'NL', folderName: 'NL' }],
    langList:     'EN (source), NL (translation)',
    hasMultiLang: true,
  });
}

function makeMinimalCtx(): TemplateContext {
  return {
    title:          'Untitled',
    author:         '',
    description:    '',
    genre:          '',
    audience:       '',
    storyFolder:    'Story',
    notesFolder:    'Notes',
    arcFolder:      'Arc',
    charactersFolder: 'Notes/Characters',
    sessionFile:    'SESSION.md',
    preferencesFile: 'PREFERENCES.md',
    arcGranularity: 'act',
    memoriesFolder: '.bindery/memories',
    languages:      [],
    langList:       'EN (source)',
    hasMultiLang:   false,
  };
}

// ─── Top-level targets ────────────────────────────────────────────────────────

describe('renderTemplate — claude', () => {
  it('contains required sections', () => {
    const result = renderTemplate('claude', makeCtx());
    expect(result).toContain('# Claude — Test Book');
    expect(result).toContain('## Project');
    expect(result).toContain('## Start of session');
    expect(result).toContain('## Memory system');
    expect(result).toContain('## Repo layout');
    expect(result).toContain('## Writing rules');
    expect(result).toContain('## Available skills');
    expect(result).toContain('## MCP server (bindery-mcp)');
  });

  it('includes genre, description, audience, and author', () => {
    const result = renderTemplate('claude', makeCtx());
    expect(result).toContain('Fantasy');
    expect(result).toContain('A tale of adventure.');
    expect(result).toContain('middle-grade');
    expect(result).toContain('Jane Doe');
  });

  it('omits optional fields when empty', () => {
    const result = renderTemplate('claude', makeMinimalCtx());
    expect(result).not.toContain('Genre:');
    expect(result).not.toContain('Author:');
    expect(result).not.toContain('Target audience:');
  });

  it('includes language section for multi-language projects', () => {
    const result = renderTemplate('claude', makeMultiLangCtx());
    expect(result).toContain('Languages:');
    expect(result).toContain('EN (source)');
    expect(result).toContain('NL (translation)');
  });

  it('includes story and arc folder paths', () => {
    const result = renderTemplate('claude', makeCtx());
    expect(result).toContain('Arc/');
    expect(result).toContain('Notes/');
    expect(result).toContain('Story/');
  });

  it('includes audience-specific writing rule when audience is set', () => {
    const result = renderTemplate('claude', makeCtx());
    expect(result).toContain('middle-grade');
  });

  it('ends with a newline', () => {
    expect(renderTemplate('claude', makeCtx())).toMatch(/\n$/);
  });
});

describe('renderTemplate — copilot', () => {
  it('contains required sections', () => {
    const result = renderTemplate('copilot', makeCtx());
    expect(result).toContain('# GitHub Copilot — Test Book');
    expect(result).toContain('## Repo layout');
    expect(result).toContain('## Writing guidelines');
  });

  it('includes genre and description when set', () => {
    const result = renderTemplate('copilot', makeCtx());
    expect(result).toContain('Fantasy');
    expect(result).toContain('A tale of adventure.');
  });

  it('omits project section entirely when all optional fields are empty', () => {
    const result = renderTemplate('copilot', makeMinimalCtx());
    expect(result).not.toContain('## Project');
  });

  it('includes audience writing guideline when audience is set', () => {
    const result = renderTemplate('copilot', makeCtx());
    expect(result).toContain('middle-grade');
  });

  it('mentions shared workspace skills from the .claude folder', () => {
    const result = renderTemplate('copilot', makeCtx());
    expect(result).toContain('.claude/skills/');
    expect(result).toContain('/translation-review');
    expect(result).toContain('/read-in');
    expect(result).toContain('/plan-beats');
    expect(result).toContain('/character-setup');
  });

  it('ends with a newline', () => {
    expect(renderTemplate('copilot', makeCtx())).toMatch(/\n$/);
  });
});

describe('renderTemplate — cursor', () => {
  it('contains required sections', () => {
    const result = renderTemplate('cursor', makeCtx());
    expect(result).toContain('# Cursor rules — Test Book');
    expect(result).toContain('## Context files to read');
    expect(result).toContain('## Rules');
  });

  it('references memory and arc folder paths', () => {
    const result = renderTemplate('cursor', makeCtx());
    expect(result).toContain('.bindery/memories');
    expect(result).toContain('Arc/');
  });

  it('includes audience rule when audience is set', () => {
    const result = renderTemplate('cursor', makeCtx());
    expect(result).toContain('middle-grade');
  });

  it('mentions shared workspace skills from the .claude folder', () => {
    const result = renderTemplate('cursor', makeCtx());
    expect(result).toContain('.claude/skills/');
    expect(result).toContain('/translation-review');
    expect(result).toContain('/proof-read');
    expect(result).toContain('/plan-beats');
    expect(result).toContain('/character-setup');
  });

  it('ends with a newline', () => {
    expect(renderTemplate('cursor', makeCtx())).toMatch(/\n$/);
  });
});

describe('renderTemplate — agents', () => {
  it('contains required sections', () => {
    const result = renderTemplate('agents', makeCtx());
    expect(result).toContain('# Agent Instructions — Test Book');
    expect(result).toContain('## Project overview');
    expect(result).toContain('## Start of session');
    expect(result).toContain('## Story files');
    expect(result).toContain('## Writing guidelines');
    expect(result).toContain('## Key reference files');
  });

  it('includes genre, description, audience, and author', () => {
    const result = renderTemplate('agents', makeCtx());
    expect(result).toContain('Fantasy');
    expect(result).toContain('A tale of adventure.');
    expect(result).toContain('middle-grade');
    expect(result).toContain('Jane Doe');
  });

  it('references memories and arc folders', () => {
    const result = renderTemplate('agents', makeCtx());
    expect(result).toContain('.bindery/memories');
    expect(result).toContain('Arc/');
  });

  it('mentions shared workspace skills from the .claude folder', () => {
    const result = renderTemplate('agents', makeCtx());
    expect(result).toContain('.claude/skills/');
    expect(result).toContain('/translation-review');
    expect(result).toContain('/review');
    expect(result).toContain('/plan-beats');
    expect(result).toContain('/character-setup');
  });

  it('ends with a newline', () => {
    expect(renderTemplate('agents', makeCtx())).toMatch(/\n$/);
  });
});

// ─── Skill templates ──────────────────────────────────────────────────────────

describe('renderTemplate — review skill', () => {
  it('contains YAML front-matter, title, trigger, and steps', () => {
    const result = renderTemplate('review', makeCtx());
    expect(result).toContain('name: review');
    expect(result).toContain('# Skill: /review');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Steps');
    expect(result).toContain('## Tools');
    expect(result).toContain('## Rules');
  });

  it('does not embed book title at generation time', () => {
    const result = renderTemplate('review', makeCtx());
    expect(result).not.toContain('"Test Book"');
  });

  it('references the arc and memories folder', () => {
    const result = renderTemplate('review', makeCtx());
    expect(result).toContain('.bindery/memories');
    expect(result).toContain('Arc/');
  });

  it('includes runtime instruction to read settings', () => {
    const result = renderTemplate('review', makeCtx());
    expect(result).toContain('.bindery/settings.json');
  });

  it('offers translation-review when translated files changed', () => {
    const result = renderTemplate('review', makeCtx());
    expect(result).toContain('/translation-review');
    expect(result).toContain('translated chapter files');
  });

  it('does not embed audience at generation time', () => {
    const result = renderTemplate('review', makeMinimalCtx());
    expect(result).not.toContain('middle-grade');
  });

  it('mentions Bindery review markers and autoStage marker consumption', () => {
    const result = renderTemplate('review', makeCtx());
    expect(result).toContain('Bindery: Review start');
    expect(result).toContain('Bindery: Review stop');
    expect(result).toContain('removes the marker lines');
  });
});

describe('renderTemplate — brainstorm skill', () => {
  it('contains YAML front-matter, title, trigger, and phases', () => {
    const result = renderTemplate('brainstorm', makeCtx());
    expect(result).toContain('name: brainstorm');
    expect(result).toContain('# Skill: /brainstorm');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Phases');
    expect(result).toContain('## Tools');
    expect(result).toContain('## Rules');
  });

  it('does not embed book title at generation time', () => {
    const result = renderTemplate('brainstorm', makeCtx());
    expect(result).not.toContain('"Test Book"');
  });
});

describe('renderTemplate — memory skill', () => {
  it('contains YAML front-matter, title, trigger, tools, and steps', () => {
    const result = renderTemplate('memory', makeCtx());
    expect(result).toContain('name: memory');
    expect(result).toContain('# Skill: /memory');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Tools');
    expect(result).toContain('## Steps');
    expect(result).toContain('## Rules');
  });

  it('references memory_append and memory_compact tools', () => {
    const result = renderTemplate('memory', makeCtx());
    expect(result).toContain('note_create');
    expect(result).toContain('note_append');
    expect(result).toContain('memory_append');
    expect(result).toContain('memory_compact');
    expect(result).toContain('memory_list');
  });

  it('describes the note and arc write-tool boundary accurately', () => {
    const result = renderTemplate('memory', makeCtx());
    expect(result).toContain('## Tool boundary');
    expect(result).toContain('note_create');
    expect(result).toContain('note_append');
    expect(result).toContain('arc_create');
    expect(result).toContain('character_update');
    expect(result).toContain('session_focus_update');
    expect(result).toContain('PREFERENCES.md');
    expect(result).toContain('inbox_process');
    expect(result).toContain('Notes/Inbox.md');
    expect(result).not.toContain('no dedicated COWORK/session-focus write tools');
    expect(result).not.toContain('## Future work');
  });
});

describe('renderTemplate — character-setup skill', () => {
  it('contains YAML front-matter, title, trigger, tools, steps, and rules', () => {
    const result = renderTemplate('character-setup', makeCtx());
    expect(result).toContain('name: character-setup');
    expect(result).toContain('# Skill: /character-setup');
    expect(result).toContain('argument-hint');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Tools');
    expect(result).toContain('## Steps');
    expect(result).toContain('## Rules');
  });

  it('uses the structured character tools', () => {
    const result = renderTemplate('character-setup', makeCtx());
    expect(result).toContain('character_list');
    expect(result).toContain('character_get');
    expect(result).toContain('character_create');
    expect(result).toContain('character_update');
  });
});

describe('renderTemplate — plan-beats skill', () => {
  it('contains YAML front-matter, title, trigger, tools, steps, and rules', () => {
    const result = renderTemplate('plan-beats', makeCtx());
    expect(result).toContain('name: plan-beats');
    expect(result).toContain('# Skill: /plan-beats');
    expect(result).toContain('argument-hint');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Tools');
    expect(result).toContain('## Steps');
    expect(result).toContain('## Rules');
  });

  it('uses the current Bindery arc and character scaffold', () => {
    const result = renderTemplate('plan-beats', makeCtx());
    expect(result).toContain('Arc/index.md');
    expect(result).toContain('Arc/Overall.md');
    expect(result).toContain('Arc/Acts/');
    expect(result).toContain('character_list');
    expect(result).toContain('character_get');
  });
});

describe('renderTemplate — translate skill', () => {
  it('contains YAML front-matter, title, trigger, tools, and steps', () => {
    const result = renderTemplate('translate', makeCtx());
    expect(result).toContain('name: translate');
    expect(result).toContain('# Skill: /translate');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Tools');
    expect(result).toContain('## Steps');
    expect(result).toContain('## Rules');
  });

  it('references get_translation and add_translation tools', () => {
    const result = renderTemplate('translate', makeCtx());
    expect(result).toContain('get_translation');
    expect(result).toContain('add_translation');
  });
});

describe('renderTemplate — translation-review skill', () => {
  it('contains YAML front-matter, title, trigger, tools, and handoff rules', () => {
    const result = renderTemplate('translation-review', makeCtx());
    expect(result).toContain('name: translation-review');
    expect(result).toContain('# Skill: /translation-review');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Not this skill');
    expect(result).toContain('## Tools');
    expect(result).toContain('## Cross-skill handoff');
    expect(result).toContain('## Rules');
  });

  it('references diff review, glossary loading, and source review handoff', () => {
    const result = renderTemplate('translation-review', makeCtx());
    expect(result).toContain('get_review_text');
    expect(result).toContain('get_translation');
    expect(result).toContain('/review');
    expect(result).toContain('line parity');
  });

  it('uses agent-agnostic context wording and glossary persistence tools', () => {
    const result = renderTemplate('translation-review', makeCtx());
    expect(result).toContain('recent conversation');
    expect(result).toContain('ask the user if ambiguous');
    expect(result).toContain('search(query, targetLanguage)');
    expect(result).toContain('add_translation');
    expect(result).toContain('call `add_translation` before moving on');
  });

  it('mentions review markers and the two-section response shape', () => {
    const result = renderTemplate('translation-review', makeCtx());
    expect(result).toContain('Bindery: Review start');
    expect(result).toContain('# Git diff');
    expect(result).toContain('# Review markers');
  });
});

describe('renderTemplate — status skill', () => {
  it('contains YAML front-matter, title, trigger, tools, and steps', () => {
    const result = renderTemplate('status', makeCtx());
    expect(result).toContain('name: status');
    expect(result).toContain('# Skill: /status');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Tools');
    expect(result).toContain('## Steps');
  });

  it('references chapter_status_get and get_overview tools', () => {
    const result = renderTemplate('status', makeCtx());
    expect(result).toContain('chapter_status_get');
    expect(result).toContain('get_overview');
  });
});

describe('renderTemplate — continuity skill', () => {
  it('contains YAML front-matter, title, trigger, tools, steps, and output format', () => {
    const result = renderTemplate('continuity', makeCtx());
    expect(result).toContain('name: continuity');
    expect(result).toContain('# Skill: /continuity');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Tools');
    expect(result).toContain('## Steps');
    expect(result).toContain('## Output format');
    expect(result).toContain('## Rules');
  });

  it('references search and get_notes tools', () => {
    const result = renderTemplate('continuity', makeCtx());
    expect(result).toContain('search');
    expect(result).toContain('get_notes');
  });
});

describe('renderTemplate — read-aloud skill', () => {
  it('contains YAML front-matter, title, trigger, tools, and rules', () => {
    const result = renderTemplate('read-aloud', makeCtx());
    expect(result).toContain('name: read-aloud');
    expect(result).toContain('# Skill: /read-aloud');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Tools');
    expect(result).toContain('## Rules');
  });

  it('includes runtime context instruction to read settings', () => {
    const result = renderTemplate('read-aloud', makeCtx());
    expect(result).toContain('.bindery/settings.json');
  });

  it('does not embed audience at generation time', () => {
    const result = renderTemplate('read-aloud', makeMinimalCtx());
    expect(result).not.toContain('middle-grade');
  });
});

describe('renderTemplate — read-in skill', () => {
  it('contains YAML front-matter, title, trigger, tools, steps, and rules', () => {
    const result = renderTemplate('read-in', makeCtx());
    expect(result).toContain('name: read-in');
    expect(result).toContain('# Skill: /read-in');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Tools');
    expect(result).toContain('## Steps');
    expect(result).toContain('## Rules');
  });

  it('references memory_list, chapter_status_get, and get_overview tools', () => {
    const result = renderTemplate('read-in', makeCtx());
    expect(result).toContain('memory_list');
    expect(result).toContain('chapter_status_get');
    expect(result).toContain('get_overview');
  });

  it('references the memories folder', () => {
    const result = renderTemplate('read-in', makeCtx());
    expect(result).toContain('.bindery/memories');
  });
});

// ─── .bindery/README.md (capabilities reference) ─────────────────────────────

describe('renderTemplate — bindery-readme', () => {
  it('includes the workspace title and key capability sections', () => {
    const result = renderTemplate('bindery-readme', makeCtx());
    expect(result).toContain('Test Book');
    expect(result).toContain('## Opinionated Authoring Layout');
    expect(result).toContain('## VS Code / Obsidian commands');
    expect(result).toContain('## MCP tools');
    expect(result).toContain('## Tool Workflow Shortcuts');
    expect(result).toContain('## Skill workflows');
    expect(result).toContain('## Review markers');
  });

  it('documents the generated scaffold and setup tools', () => {
    const result = renderTemplate('bindery-readme', makeCtx());
    expect(result).toContain('SESSION.md');
    expect(result).toContain('PREFERENCES.md');
    expect(result).toContain('session_focus_update');
    expect(result).toContain('Arc/index.md');
    expect(result).toContain('Arc/Overall.md');
    expect(result).toContain('Notes/Characters/index.md');
    expect(result).toContain('init_workspace');
    expect(result).toContain('setup_ai_files');
    expect(result).toContain('/plan-beats');
    expect(result).toContain('/character-setup');
    expect(result).toContain('note_list');
    expect(result).toContain('note_append');
    expect(result).toContain('character_list');
    expect(result).toContain('arc_create');
    expect(result).toContain('List/Create/Append Notes');
    expect(result).toContain('List/Create/Update Character Profile');
    expect(result).toContain('List/Create/Update Arc File');
    expect(result).toContain('Show/Update Chapter Status');
    expect(result).toContain('Show/Update Session Focus');
    expect(result).toContain('session_focus_get');
    expect(result).toContain('inbox_process');
    expect(result).toContain('inbox_resolve');
    expect(result).toContain('never edits it');
    expect(result).not.toContain('session-focus/COWORK tools are not available yet');
  });

  it('does not indent generated top-level README headings or table rows', () => {
    const result = renderTemplate('bindery-readme', makeCtx());
    expect(result).toContain('\n## Opinionated Authoring Layout\n');
    expect(result).toContain('\n| Path | Purpose |\n');
    expect(result).not.toContain('\n  ## Opinionated');
    expect(result).not.toContain('\n  | Path | Purpose |');
  });

  it('documents review marker syntax and consumption behavior', () => {
    const result = renderTemplate('bindery-readme', makeCtx());
    expect(result).toContain('<!-- Bindery: Review start -->');
    expect(result).toContain('<!-- Bindery: Review stop -->');
    expect(result).toContain('removes');
  });

  it('lists the new VS Code marker commands', () => {
    const result = renderTemplate('bindery-readme', makeCtx());
    expect(result).toContain('Insert Review Start Marker');
    expect(result).toContain('Insert Review Stop Marker');
  });
});

// ─── Unknown template ─────────────────────────────────────────────────────────

describe('renderTemplate — unknown', () => {
  it('returns an "Unknown template" message for unrecognised names', () => {
    const result = renderTemplate('nonexistent', makeCtx());
    expect(result).toContain('Unknown template: nonexistent');
  });
});
