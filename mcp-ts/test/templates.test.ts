import { describe, expect, it } from 'vitest';

import { renderTemplate as renderFromCore } from '@bindery/core';
import { renderTemplate as renderFromShim } from '../src/templates';

describe('templates shim', () => {
  it('re-exports renderTemplate from @bindery/core', () => {
    expect(renderFromShim).toBe(renderFromCore);
  });

  it('renders templates via shim export', () => {
    const result = renderFromShim('copilot', {
      title: 'Test Book',
      author: 'Jane Doe',
      description: 'A tale of adventure.',
      genre: 'Fantasy',
      audience: 'middle-grade',
      storyFolder: 'Story',
      notesFolder: 'Notes',
      arcFolder: 'Arc',
      memoriesFolder: '.bindery/memories',
      languages: [{ code: 'EN', folderName: 'EN' }],
      langList: 'EN (source)',
      hasMultiLang: false,
    });

    expect(result).toContain('# GitHub Copilot — Test Book');
  });
});