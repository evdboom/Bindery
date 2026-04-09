import * as fs from 'node:fs';
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest';

import {
  getBookTitleForLang,
  getSubstitutionRules,
  readTranslations,
  upsertSubstitutionRule,
  type TranslationsFile,
} from '../src/workspace';

const tempRoots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-vscode-test-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('workspace helpers', () => {
  it('resolves per-language titles with en fallback', () => {
    const title = getBookTitleForLang({ bookTitle: { en: 'Road', nl: 'Weg' } }, 'fr');
    expect(title).toBe('Road');
  });

  it('upserts substitution rules and keeps them sorted', () => {
    const root = makeRoot();

    upsertSubstitutionRule(root, 'en-gb', { from: 'color', to: 'colour' });
    upsertSubstitutionRule(root, 'en-gb', { from: 'analyze', to: 'analyse' });

    const translations = readTranslations(root);
    expect(translations).not.toBeNull();

    const rules = translations?.['en-gb']?.rules ?? [];
    expect(rules.map((r) => r.from)).toEqual(['analyze', 'color']);
  });

  it('returns only substitution entries as replacement rules', () => {
    const translations: TranslationsFile = {
      'en-gb': {
        type: 'substitution',
        rules: [{ from: 'color', to: 'colour' }],
      },
      nl: {
        type: 'glossary',
        rules: [{ from: 'FluxCore', to: 'FluxKern' }],
      },
    };

    const substitutions = getSubstitutionRules(translations, 'en-gb');
    const glossary = getSubstitutionRules(translations, 'nl');

    expect(substitutions).toEqual([{ us: 'color', uk: 'colour' }]);
    expect(glossary).toEqual([]);
  });
});
