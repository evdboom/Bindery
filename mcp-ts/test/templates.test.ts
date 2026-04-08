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

  it('ends with a newline', () => {
    expect(renderTemplate('agents', makeCtx())).toMatch(/\n$/);
  });
});

// ─── Skill templates ──────────────────────────────────────────────────────────

describe('renderTemplate — review skill', () => {
  it('contains YAML front-matter, title, trigger, and steps', () => {
    const result = renderTemplate('review', makeCtx());
    expect(result).toContain('name: Review');
    expect(result).toContain('# Skill: /review');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Detect Bindery workspace');
    expect(result).toContain('## General workflow');
    expect(result).toContain('## Bindery workflow');
    expect(result).toContain('## Rules');
  });

  it('general workflow does not contain book-specific title', () => {
    const result = renderTemplate('review', makeCtx());
    // The YAML description line should not include the book title
    const descLine = result.split('\n').find(l => l.startsWith('description:')) ?? '';
    expect(descLine).not.toContain('"Test Book"');
  });

  it('includes the book title only in the Bindery workflow section', () => {
    const result = renderTemplate('review', makeCtx());
    expect(result).toContain('"Test Book"');
  });

  it('references the arc and memories folder in Bindery workflow', () => {
    const result = renderTemplate('review', makeCtx());
    expect(result).toContain('.bindery/memories');
    expect(result).toContain('Arc/');
  });

  it('includes audience when set', () => {
    const result = renderTemplate('review', makeCtx());
    expect(result).toContain('middle-grade');
  });

  it('uses fallback audience string when empty', () => {
    const result = renderTemplate('review', makeMinimalCtx());
    expect(result).toContain('the target audience');
  });
});

describe('renderTemplate — brainstorm skill', () => {
  it('contains YAML front-matter, title, trigger, general and Bindery workflows', () => {
    const result = renderTemplate('brainstorm', makeCtx());
    expect(result).toContain('name: Brainstorm');
    expect(result).toContain('# Skill: /brainstorm');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Detect Bindery workspace');
    expect(result).toContain('## General workflow');
    expect(result).toContain('## Bindery workflow');
    expect(result).toContain('## Rules');
  });

  it('includes the book title only in Bindery workflow section', () => {
    const result = renderTemplate('brainstorm', makeCtx());
    // YAML description line should NOT include the book title
    const descLine = result.split('\n').find(l => l.startsWith('description:')) ?? '';
    expect(descLine).not.toContain('"Test Book"');
    // But it should appear in the Bindery workflow body
    expect(result).toContain('"Test Book"');
  });
});

describe('renderTemplate — memory skill', () => {
  it('contains YAML front-matter, title, trigger, tools, and steps', () => {
    const result = renderTemplate('memory', makeCtx());
    expect(result).toContain('name: Memory');
    expect(result).toContain('# Skill: /memory');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Detect Bindery workspace');
    expect(result).toContain('## General workflow');
    expect(result).toContain('## Bindery workflow');
    expect(result).toContain('## Rules');
  });

  it('references memory_append and memory_compact tools in Bindery workflow', () => {
    const result = renderTemplate('memory', makeCtx());
    expect(result).toContain('memory_append');
    expect(result).toContain('memory_compact');
    expect(result).toContain('memory_list');
  });
});

describe('renderTemplate — translate skill', () => {
  it('contains YAML front-matter, title, trigger, and both workflows', () => {
    const result = renderTemplate('translate', makeCtx());
    expect(result).toContain('name: Translate');
    expect(result).toContain('# Skill: /translate');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Detect Bindery workspace');
    expect(result).toContain('## General workflow');
    expect(result).toContain('## Bindery workflow');
    expect(result).toContain('## Rules');
  });

  it('references get_translation and add_translation tools in Bindery workflow', () => {
    const result = renderTemplate('translate', makeCtx());
    expect(result).toContain('get_translation');
    expect(result).toContain('add_translation');
  });
});

describe('renderTemplate — status skill', () => {
  it('contains YAML front-matter, title, trigger, and both workflows', () => {
    const result = renderTemplate('status', makeCtx());
    expect(result).toContain('name: Status');
    expect(result).toContain('# Skill: /status');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Detect Bindery workspace');
    expect(result).toContain('## General workflow');
    expect(result).toContain('## Bindery workflow');
  });

  it('references chapter_status_get and get_overview tools in Bindery workflow', () => {
    const result = renderTemplate('status', makeCtx());
    expect(result).toContain('chapter_status_get');
    expect(result).toContain('get_overview');
  });
});

describe('renderTemplate — continuity skill', () => {
  it('contains YAML front-matter, title, trigger, both workflows, output format, and rules', () => {
    const result = renderTemplate('continuity', makeCtx());
    expect(result).toContain('name: Continuity');
    expect(result).toContain('# Skill: /continuity');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Detect Bindery workspace');
    expect(result).toContain('## General workflow');
    expect(result).toContain('## Bindery workflow');
    expect(result).toContain('## Output format');
    expect(result).toContain('## Rules');
  });

  it('references retrieve_context and get_notes tools in Bindery workflow', () => {
    const result = renderTemplate('continuity', makeCtx());
    expect(result).toContain('retrieve_context');
    expect(result).toContain('get_notes');
  });
});

describe('renderTemplate — read_aloud skill', () => {
  it('contains YAML front-matter, title, trigger, both workflows, and rules', () => {
    const result = renderTemplate('read_aloud', makeCtx());
    expect(result).toContain('name: Read Aloud');
    expect(result).toContain('# Skill: /read-aloud');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Detect Bindery workspace');
    expect(result).toContain('## General workflow');
    expect(result).toContain('## Bindery workflow');
    expect(result).toContain('## Rules');
  });

  it('includes audience in output description', () => {
    const result = renderTemplate('read_aloud', makeCtx());
    expect(result).toContain('middle-grade');
  });

  it('uses fallback when audience is empty', () => {
    const result = renderTemplate('read_aloud', makeMinimalCtx());
    expect(result).toContain('the target audience');
  });
});

describe('renderTemplate — read_in skill', () => {
  it('contains YAML front-matter, title, trigger, both workflows, and rules', () => {
    const result = renderTemplate('read_in', makeCtx());
    expect(result).toContain('name: Read-in');
    expect(result).toContain('# Skill: /read-in');
    expect(result).toContain('## Trigger');
    expect(result).toContain('## Detect Bindery workspace');
    expect(result).toContain('## General workflow');
    expect(result).toContain('## Bindery workflow');
    expect(result).toContain('## Rules');
  });

  it('references memory_list, chapter_status_get, and get_overview tools in Bindery workflow', () => {
    const result = renderTemplate('read_in', makeCtx());
    expect(result).toContain('memory_list');
    expect(result).toContain('chapter_status_get');
    expect(result).toContain('get_overview');
  });

  it('references the memories folder in Bindery workflow', () => {
    const result = renderTemplate('read_in', makeCtx());
    expect(result).toContain('.bindery/memories');
  });
});

// ─── Unknown template ─────────────────────────────────────────────────────────

describe('renderTemplate — unknown', () => {
  it('returns an "Unknown template" message for unrecognised names', () => {
    const result = renderTemplate('nonexistent', makeCtx());
    expect(result).toContain('Unknown template: nonexistent');
  });
});
