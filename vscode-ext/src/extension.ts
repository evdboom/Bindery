/**
 * Bindery — VS Code Extension
 *
 * Markdown book authoring tools:
 *   - Typography formatting (curly quotes, em-dashes, ellipses)
 *   - Chapter merge/export → Markdown, DOCX, EPUB, PDF
 *   - Dialect conversion (US → UK, extensible via translations.json)
 *
 * Workspace configuration lives in .bindery/settings.json and .bindery/translations.json.
 * VS Code settings serve as a fallback; machine-specific paths (pandoc, LibreOffice)
 * are intentionally kept in VS Code settings only.
 */

import * as vscode from 'vscode';
import * as fs     from 'fs';
import * as path   from 'path';
import { execSync } from 'child_process';
import { updateTypography }                    from './format';
import {
    mergeBook, checkPandoc, getBuiltInUkReplacements,
    type LanguageConfig, type OutputType, type MergeOptions, type UkReplacement,
} from './merge';
import {
    readWorkspaceSettings, readTranslations,
    getBinderyFolder, getSettingsPath, getTranslationsPath,
    getBookTitleForLang, getSubstitutionRules, getIgnoredWords,
    upsertSubstitutionRule, addIgnoredWords,
    type WorkspaceSettings, type TranslationsFile,
} from './workspace';
import {
    setupAiFiles, ALL_SKILLS, AI_SETUP_VERSION, readAiSetupVersion,
    type AiTarget, type SkillTemplate,
} from './ai-setup';
import { registerLmTools, registerMcpCommand } from './mcp';

// ─── Known language presets ───────────────────────────────────────────────────

const KNOWN_LANGUAGES: Record<string, LanguageConfig> = {
    EN: { code: 'EN', folderName: 'EN', chapterWord: 'Chapter',   actPrefix: 'Act',  prologueLabel: 'Prologue', epilogueLabel: 'Epilogue'  },
    NL: { code: 'NL', folderName: 'NL', chapterWord: 'Hoofdstuk', actPrefix: 'Deel', prologueLabel: 'Proloog',  epilogueLabel: 'Epiloog'   },
    UK: { code: 'UK', folderName: 'UK', chapterWord: 'Chapter',   actPrefix: 'Act',  prologueLabel: 'Prologue', epilogueLabel: 'Epilogue'  },
    FR: { code: 'FR', folderName: 'FR', chapterWord: 'Chapitre',  actPrefix: 'Acte', prologueLabel: 'Prologue', epilogueLabel: 'Épilogue'  },
    DE: { code: 'DE', folderName: 'DE', chapterWord: 'Kapitel',   actPrefix: 'Teil', prologueLabel: 'Prolog',   epilogueLabel: 'Epilog'    },
    ES: { code: 'ES', folderName: 'ES', chapterWord: 'Capítulo',  actPrefix: 'Acto', prologueLabel: 'Prólogo',  epilogueLabel: 'Epílogo'   },
};

const DEFAULT_LANGUAGE: LanguageConfig = KNOWN_LANGUAGES.EN;

// ─── VS Code config + workspace helpers ──────────────────────────────────────

function getVscConfig() {
    return vscode.workspace.getConfiguration('bindery');
}

function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

interface EffectiveConfig {
    storyFolder:     string;
    mergedOutputDir: string;
    mergeFilePrefix: string;
    formatOnSave:    boolean;
    author:          string | undefined;
    bookTitle:       string | undefined;
    languages:       LanguageConfig[];
    pandocPath:      string;
    libreOfficePath: string;
}

/**
 * Merge workspace file settings with VS Code settings.
 * Workspace file wins for every key it defines.
 * pandoc/libreOffice paths are always taken from VS Code settings (machine-specific).
 */
function getEffectiveConfig(wsSettings: WorkspaceSettings | null): EffectiveConfig {
    const vsc = getVscConfig();
    return {
        storyFolder:     wsSettings?.storyFolder     ?? vsc.get<string>('storyFolder')     ?? 'Story',
        mergedOutputDir: wsSettings?.mergedOutputDir ?? vsc.get<string>('mergedOutputDir') ?? 'Merged',
        mergeFilePrefix: wsSettings?.mergeFilePrefix ?? vsc.get<string>('mergeFilePrefix') ?? 'Book',
        formatOnSave:    wsSettings?.formatOnSave    ?? vsc.get<boolean>('formatOnSave')   ?? false,
        author:          (wsSettings?.author         || vsc.get<string>('author'))         || undefined,
        bookTitle: (typeof wsSettings?.bookTitle === 'string' ? wsSettings.bookTitle : undefined)
                   || vsc.get<string>('bookTitle')
                   || undefined,
        languages:       wsSettings?.languages
                         ?? vsc.get<LanguageConfig[]>('languages')
                         ?? [DEFAULT_LANGUAGE],
        pandocPath:      vsc.get<string>('pandocPath')      ?? 'pandoc',
        libreOfficePath: vsc.get<string>('libreOfficePath') ?? 'libreoffice',
    };
}

/** True if filePath is inside <root>/<storyFolder>/. */
function isInsideStoryFolder(filePath: string, root: string, storyFolder: string): boolean {
    // Normalise separators so Windows paths compare correctly
    const norm  = (p: string) => p.replace(/\\/g, '/');
    const story = norm(path.join(root, storyFolder));
    const file  = norm(filePath);
    return file.startsWith(story + '/');
}

function isUkLanguage(lang: LanguageConfig): boolean {
    const c = lang.code.trim().toUpperCase();
    return c === 'UK' || c === 'EN-GB';
}

function languageCanExport(root: string, storyFolder: string, lang: LanguageConfig): boolean {
    if (isUkLanguage(lang)) {
        return fs.existsSync(path.join(root, storyFolder, 'EN'));
    }
    return fs.existsSync(path.join(root, storyFolder, lang.folderName));
}

// ─── Substitution tier helpers ────────────────────────────────────────────────
//
//  Tier 1 (built-in)  — UK_REPLACEMENTS array inside merge.ts, always applied first.
//  Tier 2 (general)   — bindery.generalSubstitutions in VS Code *user* settings.
//                        Words you want across every project (e.g. recognize→recognise).
//  Tier 3 (project)   — .bindery/translations.json → en-gb entry.
//                        Terms specific to this book/world.
//
//  Later tiers win on conflict.

function getGeneralSubstitutions(): UkReplacement[] {
    const entries = getVscConfig().get<Array<{ from?: string; to?: string }>>('generalSubstitutions') ?? [];
    return entries
        .filter(e => e?.from?.trim() && e?.to?.trim())
        .map(e => ({ us: e.from!.trim().toLowerCase(), uk: e.to!.trim() }));
}

/**
 * Build the combined substitution list passed to merge.ts.
 * merge.ts applies tier 1 (built-ins) internally; this function merges tiers 2 + 3.
 */
function buildCombinedSubstitutions(translations: TranslationsFile | null): UkReplacement[] {
    const general = getGeneralSubstitutions();
    const project = getSubstitutionRules(translations, 'en-gb');
    const map = new Map<string, string>();
    for (const r of general) { map.set(r.us, r.uk); }
    for (const r of project) { map.set(r.us, r.uk); }   // project overrides general
    return Array.from(map.entries()).map(([us, uk]) => ({ us, uk }));
}

/**
 * Combined ignored-words from translations.json (primary) and legacy
 * bindery.ukIgnoredWords VS Code setting (fallback / migration path).
 */
function getAllIgnoredWords(translations: TranslationsFile | null): Set<string> {
    const result = getIgnoredWords(translations, 'en-gb');
    for (const word of getVscConfig().get<string[]>('ukIgnoredWords') ?? []) {
        const w = word.trim().toLowerCase();
        if (w) { result.add(w); }
    }
    return result;
}

async function upsertGeneralSubstitution(rule: { from: string; to: string }): Promise<void> {
    const config  = getVscConfig();
    const current = config.get<Array<{ from?: string; to?: string }>>('generalSubstitutions') ?? [];
    const map     = new Map<string, string>(
        current
            .filter(e => e.from?.trim() && e.to?.trim())
            .map(e => [e.from!.trim().toLowerCase(), e.to!.trim()])
    );
    map.set(rule.from.toLowerCase(), rule.to);
    const updated = Array.from(map.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([from, to]) => ({ from, to }));
    await config.update('generalSubstitutions', updated, vscode.ConfigurationTarget.Global);
}

// ─── UK spelling suggestion ───────────────────────────────────────────────────

function suggestUkSpelling(usWord: string): string | undefined {
    const lower = usWord.toLowerCase();
    const builtInMap = new Map(getBuiltInUkReplacements().map(r => [r.us.toLowerCase(), r.uk]));
    if (builtInMap.has(lower)) { return builtInMap.get(lower); }
    if (lower.endsWith('izations')) { return lower.replace(/izations$/, 'isations'); }
    if (lower.endsWith('ization'))  { return lower.replace(/ization$/,  'isation');  }
    if (lower.endsWith('izing'))    { return lower.replace(/izing$/,    'ising');    }
    if (lower.endsWith('izes'))     { return lower.replace(/izes$/,     'ises');     }
    if (lower.endsWith('ized'))     { return lower.replace(/ized$/,     'ised');     }
    if (lower.endsWith('ize'))      { return lower.replace(/ize$/,      'ise');      }
    if (lower.endsWith('yzing'))    { return lower.replace(/yzing$/,    'ysing');    }
    if (lower.endsWith('yzes'))     { return lower.replace(/yzes$/,     'yses');     }
    if (lower.endsWith('yzed'))     { return lower.replace(/yzed$/,     'ysed');     }
    if (lower.endsWith('yze'))      { return lower.replace(/yze$/,      'yse');      }
    return undefined;
}

const PROBABLE_US_RE = /\b([A-Za-z]+(?:ization|izations|izing|ized|izes|ize|yzing|yzed|yzes|yze)|color(?:s|ed|ing)?|center(?:s|ed|ing)?|favorite(?:s)?|favor(?:s|ed|ing)?|traveled|traveling|traveler|travelers|canceled|canceling|gray|fiber|defense|offense|mom)\b/g;

// ─── Language auto-detection (for init) ──────────────────────────────────────

function detectLanguageFolders(storyPath: string): LanguageConfig[] {
    if (!fs.existsSync(storyPath)) { return []; }
    const detected: LanguageConfig[] = [];
    for (const entry of fs.readdirSync(storyPath, { withFileTypes: true })) {
        if (!entry.isDirectory()) { continue; }
        const code = entry.name.toUpperCase();
        if (KNOWN_LANGUAGES[code]) {
            detected.push(KNOWN_LANGUAGES[code]);
        } else if (/^[A-Z]{2,3}$/.test(code)) {
            // Unknown code — add with English defaults; user can edit settings.json
            detected.push({
                code,
                folderName:    entry.name,
                chapterWord:   'Chapter',
                actPrefix:     'Act',
                prologueLabel: 'Prologue',
                epilogueLabel: 'Epilogue',
            });
        }
    }
    return detected;
}

// ─── Command: Init workspace ─────────────────────────────────────────────────

async function initWorkspaceCommand() {
    const root = getWorkspaceRoot();
    if (!root) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

    const settingsPath = getSettingsPath(root);
    if (fs.existsSync(settingsPath)) {
        const choice = await vscode.window.showQuickPick(
            [
                { label: 'Re-initialise', description: 'Overwrites settings.json (translations.json is kept)', value: true  as const },
                { label: 'Cancel',                                                                               value: false as const },
            ],
            { placeHolder: '.bindery/settings.json already exists' }
        );
        if (!choice?.value) { return; }
    }

    const title = await vscode.window.showInputBox({
        title:       'Bindery: Initialise (1/4)',
        prompt:      'Book title',
        placeHolder: 'e.g. The Hollow Road',
    });
    if (title === undefined) { return; }

    const author = await vscode.window.showInputBox({
        title:       'Bindery: Initialise (2/4)',
        prompt:      'Author name',
        placeHolder: 'e.g. Jane Smith',
    });
    if (author === undefined) { return; }

    const storyFolder = await vscode.window.showInputBox({
        title:  'Bindery: Initialise (3/4)',
        prompt: 'Story folder name (relative to workspace root)',
        value:  'Story',
    });
    if (!storyFolder) { return; }

    const audience = await vscode.window.showInputBox({
        title:       'Bindery: Initialise (4/5)',
        prompt:      'Target audience (used for AI review feedback)',
        placeHolder: 'e.g. 12+, adults, 8-10',
    });
    if (audience === undefined) { return; }

    const formatOption = await vscode.window.showQuickPick(
        [
            { label: 'No',  value: false as const },
            { label: 'Yes', value: true  as const },
        ],
        { title: 'Bindery: Initialise (5/5)', placeHolder: 'Auto-apply typography on save (Story folder only)?' }
    );
    if (!formatOption) { return; }

    // Detect existing language folders to pre-populate languages array
    const detectedLangs = detectLanguageFolders(path.join(root, storyFolder));
    const languages     = detectedLangs.length > 0 ? detectedLangs : [DEFAULT_LANGUAGE];

    const slug: string = title.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/, '') || 'Book';

    const settings: WorkspaceSettings = {
        ...(title    ? { bookTitle: title }             : {}),
        ...(author   ? { author }                       : {}),
        ...(audience ? { targetAudience: audience }     : {}),
        storyFolder,
        mergedOutputDir: 'Merged',
        mergeFilePrefix: slug,
        formatOnSave:    formatOption.value,
        languages,
    };

    const binderyFolder = getBinderyFolder(root);
    fs.mkdirSync(binderyFolder, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

    // Create translations.json only if it does not yet exist
    const translationsPath = getTranslationsPath(root);
    if (!fs.existsSync(translationsPath)) {
        const translations = {
            'en-gb': {
                label:          'British English',
                type:           'substitution',
                sourceLanguage: 'en',
                rules:          [],
                ignoredWords:   [],
            },
        };
        fs.writeFileSync(translationsPath, JSON.stringify(translations, null, 2) + '\n', 'utf-8');
    }

    // Ensure git repo exists for version tracking
    let gitNote = '';
    if (!fs.existsSync(path.join(root, '.git'))) {
        try {
            execSync('git --version', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
            execSync('git init', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });

            // Create .gitignore if it doesn't exist
            const gitignorePath = path.join(root, '.gitignore');
            if (!fs.existsSync(gitignorePath)) {
                fs.writeFileSync(gitignorePath, [
                    'Merged/',
                    '*.docx',
                    '*.epub',
                    '*.pdf',
                    'node_modules/',
                    '',
                ].join('\n'), 'utf-8');
            }

            execSync('git add .bindery/ .gitignore', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
            execSync('git commit -m "Bindery: initial setup"', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
            gitNote = ' Git repository initialised.';
        } catch {
            vscode.window.showWarningMessage(
                'Git is recommended for version tracking and review features. ' +
                'Install from https://git-scm.com'
            );
        }
    }

    const langNote = detectedLangs.length > 0
        ? ` Detected: ${detectedLangs.map(l => l.code).join(', ')}.`
        : '';
    const action = await vscode.window.showInformationMessage(
        `Bindery workspace initialised.${langNote}${gitNote}`,
        'Open settings.json',
        'Open translations.json'
    );
    if (action === 'Open settings.json') {
        vscode.window.showTextDocument(await vscode.workspace.openTextDocument(settingsPath));
    } else if (action === 'Open translations.json') {
        vscode.window.showTextDocument(await vscode.workspace.openTextDocument(translationsPath));
    }
}

// ─── Command: Open translations.json ─────────────────────────────────────────

async function openTranslationsCommand() {
    const root = getWorkspaceRoot();
    if (!root) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

    const translationsPath = getTranslationsPath(root);

    if (!fs.existsSync(translationsPath)) {
        const create = await vscode.window.showWarningMessage(
            '.bindery/translations.json does not exist yet.',
            'Create it',
            'Cancel'
        );
        if (create !== 'Create it') { return; }

        // Auto-detect substitution languages from settings
        const wsSettings = readWorkspaceSettings(root);
        const languages  = wsSettings?.languages ?? [DEFAULT_LANGUAGE];
        const skeleton: Record<string, unknown> = {};

        for (const lang of languages) {
            const code = lang.code.toUpperCase();
            if (code !== 'EN') {
                const key = code.toLowerCase();
                skeleton[key] = {
                    label:          lang.folderName,
                    type:           'substitution',
                    sourceLanguage: 'en',
                    rules:          [],
                    ignoredWords:   [],
                };
            }
        }

        // Always include en-gb for British English substitutions if not already present
        if (!skeleton['en-gb'] && !skeleton['uk']) {
            skeleton['en-gb'] = {
                label:          'British English',
                type:           'substitution',
                sourceLanguage: 'en',
                rules:          [],
                ignoredWords:   [],
            };
        }

        fs.mkdirSync(path.dirname(translationsPath), { recursive: true });
        fs.writeFileSync(translationsPath, JSON.stringify(skeleton, null, 2) + '\n', 'utf-8');
    }

    vscode.window.showTextDocument(await vscode.workspace.openTextDocument(translationsPath));
}

// ─── Command: Add substitution rule ──────────────────────────────────────────

async function addTranslationCommand() {
    const root = getWorkspaceRoot();

    // Pre-fill "from" with editor selection (if any)
    const editor   = vscode.window.activeTextEditor;
    const selected = editor && !editor.selection.isEmpty
        ? editor.document.getText(editor.selection).trim()
        : '';

    // Determine which substitution entry to target from translations.json
    let langKey   = 'en-gb';
    let fromLabel = 'source';
    let toLabel   = 'target';

    if (root) {
        const translations = readTranslations(root);
        const substitutionEntries = Object.entries(translations ?? {})
            .filter(([, entry]) => entry.type === 'substitution');

        if (substitutionEntries.length === 1) {
            langKey   = substitutionEntries[0][0];
            const e   = substitutionEntries[0][1];
            fromLabel = e.sourceLanguage ?? 'source';
            toLabel   = e.label ?? langKey;
        } else if (substitutionEntries.length > 1) {
            // Try to auto-detect from active file path
            let autoKey: string | undefined;
            if (editor) {
                const wsSettings = readWorkspaceSettings(root);
                const sf = wsSettings?.storyFolder ?? 'Story';
                const filePath = editor.document.uri.fsPath.replace(/\\/g, '/');
                const storyBase = path.join(root, sf).replace(/\\/g, '/');
                if (filePath.startsWith(storyBase)) {
                    const rel = filePath.slice(storyBase.length + 1);
                    const folderName = rel.split('/')[0];
                    // Match folder to a substitution entry's sourceLanguage
                    for (const [key, entry] of substitutionEntries) {
                        if (entry.sourceLanguage?.toUpperCase() === folderName?.toUpperCase()) {
                            autoKey = key;
                            break;
                        }
                    }
                }
            }

            if (autoKey) {
                langKey = autoKey;
                const e = substitutionEntries.find(([k]) => k === autoKey)![1];
                fromLabel = e.sourceLanguage ?? 'source';
                toLabel   = e.label ?? langKey;
            } else {
                const picked = await vscode.window.showQuickPick(
                    substitutionEntries.map(([key, entry]) => ({
                        label:       entry.label ?? key,
                        description: `key: ${key}`,
                        key,
                        entry,
                    })),
                    { placeHolder: 'Which substitution language?' }
                );
                if (!picked) { return; }
                langKey   = picked.key;
                fromLabel = picked.entry.sourceLanguage ?? 'source';
                toLabel   = picked.entry.label ?? langKey;
            }
        }
    }

    const fromWord = await vscode.window.showInputBox({
        title:       'Add Substitution Rule — source word',
        prompt:      `${fromLabel} word`,
        value:       selected,
        placeHolder: 'e.g. airplane',
    });
    if (!fromWord) { return; }

    const suggested = suggestUkSpelling(fromWord) ?? '';
    const toWord = await vscode.window.showInputBox({
        title:       'Add Substitution Rule — target word',
        prompt:      `${toLabel} word`,
        value:       suggested,
        placeHolder: 'e.g. aeroplane',
    });
    if (!toWord) { return; }

    const scope = await vscode.window.showQuickPick(
        [
            { label: 'This project only', description: 'Saved to .bindery/translations.json',        value: 'project' as const },
            { label: 'All projects',      description: 'Saved to your VS Code user settings',        value: 'general' as const },
        ],
        { placeHolder: 'Where should this rule be saved?' }
    );
    if (!scope) { return; }

    if (scope.value === 'project') {
        if (!root) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
        upsertSubstitutionRule(root, langKey, { from: fromWord.toLowerCase(), to: toWord });
        vscode.window.showInformationMessage(`Saved to .bindery/translations.json: ${fromWord.toLowerCase()} → ${toWord}`);
    } else {
        await upsertGeneralSubstitution({ from: fromWord.toLowerCase(), to: toWord });
        vscode.window.showInformationMessage(`Saved to general user settings: ${fromWord.toLowerCase()} → ${toWord}`);
    }
}

// ─── Command: Find probable US→UK words ──────────────────────────────────────

async function findProbableUsToUkWordsCommand() {
    const root = getWorkspaceRoot();
    if (!root) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

    const wsSettings    = readWorkspaceSettings(root);
    const translations  = readTranslations(root);
    const storyFolder   = getEffectiveConfig(wsSettings).storyFolder;
    const enPath        = path.join(root, storyFolder, 'EN');

    if (!fs.existsSync(enPath)) {
        vscode.window.showErrorMessage(`EN source folder not found: ${enPath}`);
        return;
    }

    // Scan EN story files for probable US words
    const found = new Set<string>();
    const stack = [enPath];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) { stack.push(fullPath); continue; }
            if (!entry.isFile() || !entry.name.endsWith('.md')) { continue; }
            const lines    = fs.readFileSync(fullPath, 'utf-8').split(/\r?\n/);
            let inFence    = false;
            for (const line of lines) {
                if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
                if (inFence) { continue; }
                PROBABLE_US_RE.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = PROBABLE_US_RE.exec(line)) !== null) {
                    found.add(m[1].toLowerCase());
                }
            }
        }
    }

    // Filter out already-handled words
    const configuredProject = new Set(getSubstitutionRules(translations, 'en-gb').map(r => r.us));
    const configuredGeneral = new Set(getGeneralSubstitutions().map(r => r.us));
    const builtIn           = new Set(getBuiltInUkReplacements().map(r => r.us.toLowerCase()));
    const ignored           = getAllIgnoredWords(translations);

    const candidates = Array.from(found)
        .filter(w => !ignored.has(w) && !configuredProject.has(w) && !configuredGeneral.has(w) && !builtIn.has(w))
        .map(w  => ({ us: w, uk: suggestUkSpelling(w) }))
        .filter(c => !!c.uk)
        .sort((a, b) => a.us.localeCompare(b.us));

    if (candidates.length === 0) {
        vscode.window.showInformationMessage(`No new probable US→UK words found in ${storyFolder}/EN.`);
        return;
    }

    const picks = await vscode.window.showQuickPick(
        candidates.map(c => ({
            label:       `${c.us} → ${c.uk!}`,
            description: '',
            us:          c.us,
            uk:          c.uk!,
        })),
        { canPickMany: true, placeHolder: 'Select words, then choose an action' }
    );
    if (!picks || picks.length === 0) { return; }

    const action = await vscode.window.showQuickPick(
        [
            { label: 'Add — this project',  description: 'To .bindery/translations.json',    value: 'project' as const },
            { label: 'Add — all projects',  description: 'To your VS Code user settings',    value: 'general' as const },
            { label: 'Ignore',              description: 'Add to ignored list for this project', value: 'ignore'  as const },
        ],
        { placeHolder: `Action for ${picks.length} selected word(s)` }
    );
    if (!action) { return; }

    if (action.value === 'project') {
        for (const pick of picks) {
            upsertSubstitutionRule(root, 'en-gb', { from: pick.us, to: pick.uk });
        }
        vscode.window.showInformationMessage(`Added ${picks.length} rule(s) to .bindery/translations.json.`);
    } else if (action.value === 'general') {
        for (const pick of picks) {
            await upsertGeneralSubstitution({ from: pick.us, to: pick.uk });
        }
        vscode.window.showInformationMessage(`Added ${picks.length} rule(s) to general user settings.`);
    } else {
        const added = addIgnoredWords(root, 'en-gb', picks.map(p => p.us));
        vscode.window.showInformationMessage(`Ignored ${added} word(s) in .bindery/translations.json.`);
    }
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

function buildMergeOptions(
    root:         string,
    lang:         LanguageConfig,
    outputTypes:  OutputType[],
    wsSettings:   WorkspaceSettings | null,
    translations: TranslationsFile | null,
): MergeOptions {
    const cfg = getEffectiveConfig(wsSettings);

    // Language-specific title from workspace file, falling back to the global title
    const bookTitle = getBookTitleForLang(wsSettings, lang.code) ?? cfg.bookTitle;

    return {
        root,
        storyFolder:     cfg.storyFolder,
        language:        lang,
        outputTypes,
        includeToc:      true,
        includeSeparators: true,
        author:          cfg.author,
        bookTitle,
        outputDir:       cfg.mergedOutputDir,
        filePrefix:      cfg.mergeFilePrefix,
        pandocPath:      cfg.pandocPath,
        libreOfficePath: cfg.libreOfficePath,
        ukReplacements:  buildCombinedSubstitutions(translations),
    };
}

// ─── Command: Setup AI assistant files ───────────────────────────────────────

const AI_TARGET_ITEMS: Array<{ label: string; detail: string; value: AiTarget }> = [
    { label: '$(symbol-misc) Claude (Cowork / Claude Code)', detail: 'Generates CLAUDE.md and .claude/skills/ templates', value: 'claude'  },
    { label: '$(github) GitHub Copilot',                     detail: 'Generates .github/copilot-instructions.md',          value: 'copilot' },
    { label: '$(edit) Cursor',                               detail: 'Generates .cursor/rules',                             value: 'cursor'  },
    { label: '$(robot) Agents (OpenAI / Aider / Codex)',     detail: 'Generates AGENTS.md',                                value: 'agents'  },
];

const SKILL_ITEMS: Array<{ label: string; description: string; value: SkillTemplate }> = [
    { label: '/review',     description: 'Chapter review — language, arc, age-appropriateness',   value: 'review'     },
    { label: '/brainstorm', description: 'Generate plot / character / scene ideas',               value: 'brainstorm' },
    { label: '/memory',     description: 'Update memory files and compact if needed',             value: 'memory'     },
    { label: '/translate',  description: 'Assisted chapter translation',                          value: 'translate'  },
    { label: '/status',     description: 'Book progress snapshot',                               value: 'status'     },
    { label: '/continuity', description: 'Cross-check chapter for consistency errors',           value: 'continuity' },
    { label: '/read-aloud', description: 'Reading-aloud test for a chapter or passage',          value: 'read_aloud' },
];

async function setupAiCommand() {
    const root = getWorkspaceRoot();
    if (!root) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

    const wsSettings = readWorkspaceSettings(root);
    if (!wsSettings) {
        const init = await vscode.window.showWarningMessage(
            'No .bindery/settings.json found. Run "Bindery: Initialise Workspace" first.',
            'Initialise now'
        );
        if (init) { await initWorkspaceCommand(); }
        return;
    }

    // Fill in any missing context fields interactively
    const settings = { ...wsSettings };

    if (!settings.description) {
        const desc = await vscode.window.showInputBox({
            title:       'Bindery: Setup AI — project description',
            prompt:      'One-line description used in AI instruction files',
            placeHolder: 'e.g. Post-apocalyptic sci-fi/fantasy adventure',
        });
        if (desc === undefined) { return; }
        if (desc) { settings.description = desc; }
    }

    if (!settings.genre) {
        const genre = await vscode.window.showInputBox({
            title:       'Bindery: Setup AI — genre',
            prompt:      'Genre (used in AI instruction files)',
            placeHolder: 'e.g. sci-fi/fantasy, mystery, contemporary fiction',
        });
        if (genre === undefined) { return; }
        if (genre) { settings.genre = genre; }
    }

    if (!settings.targetAudience) {
        const audience = await vscode.window.showInputBox({
            title:       'Bindery: Setup AI — target audience',
            prompt:      'Target audience (used to calibrate review feedback)',
            placeHolder: 'e.g. 12+, adults, 8-10',
        });
        if (audience === undefined) { return; }
        if (audience) { settings.targetAudience = audience; }
    }

    // Save any new fields back to settings.json
    const hasNew = settings.description !== wsSettings.description
                || settings.genre       !== wsSettings.genre
                || settings.targetAudience !== wsSettings.targetAudience;
    if (hasNew) {
        const settingsPath = getSettingsPath(root);
        try {
            const current = JSON.parse(require('fs').readFileSync(settingsPath, 'utf-8'));
            const updated  = { ...current, ...settings };
            require('fs').writeFileSync(settingsPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
        } catch { /* non-fatal */ }
    }

    // Select AI targets
    const targetPicks = await vscode.window.showQuickPick(AI_TARGET_ITEMS, {
        canPickMany:  true,
        placeHolder:  'Select AI assistants to set up',
    });
    if (!targetPicks || targetPicks.length === 0) { return; }
    const targets = targetPicks.map(p => p.value);

    // Select skills (only for Claude target)
    let skills: SkillTemplate[] = ALL_SKILLS;
    if (targets.includes('claude')) {
        const skillPicks = await vscode.window.showQuickPick(SKILL_ITEMS, {
            canPickMany:  true,
            placeHolder:  'Select skill templates to generate (.claude/skills/)',
        });
        if (skillPicks === undefined) { return; }
        skills = skillPicks.length > 0 ? skillPicks.map(p => p.value) : [];
    }

    // Overwrite existing?
    const overwritePick = await vscode.window.showQuickPick(
        [
            { label: 'Skip existing files',      value: false as const },
            { label: 'Overwrite existing files', value: true  as const },
        ],
        { placeHolder: 'How should existing files be handled?' }
    );
    if (!overwritePick) { return; }

    // Generate
    const result = setupAiFiles({ root, settings, targets, skills, overwrite: overwritePick.value });

    const summary: string[] = [];
    if (result.created.length > 0) {
        summary.push(`Created: ${result.created.join(', ')}`);
    }
    if (result.skipped.length > 0) {
        summary.push(`Skipped (already exist): ${result.skipped.join(', ')}`);
    }

    const msg = summary.length > 0 ? summary.join(' | ') : 'No files generated.';
    vscode.window.showInformationMessage(msg);
}

// ─── Typography formatting provider ──────────────────────────────────────────

class TypographyFormattingProvider implements vscode.DocumentFormattingEditProvider {
    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        _options: vscode.FormattingOptions,
        _token:   vscode.CancellationToken,
    ): vscode.TextEdit[] {
        const original  = document.getText();
        const formatted = updateTypography(original);
        if (original === formatted) { return []; }
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(original.length)
        );
        return [vscode.TextEdit.replace(fullRange, formatted)];
    }
}

// ─── Commands: format ─────────────────────────────────────────────────────────

async function formatDocumentCommand(uri?: vscode.Uri) {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) { vscode.window.showWarningMessage('No markdown file selected.'); return; }

    const doc       = await vscode.workspace.openTextDocument(targetUri);
    const original  = doc.getText();
    const formatted = updateTypography(original);

    if (original === formatted) {
        vscode.window.showInformationMessage('Typography: no changes needed.');
        return;
    }
    const edit      = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(original.length));
    edit.replace(targetUri, fullRange, formatted);
    await vscode.workspace.applyEdit(edit);
    vscode.window.showInformationMessage('Typography formatting applied.');
}

async function formatFolderCommand(uri?: vscode.Uri) {
    const targetUri = uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!targetUri) { vscode.window.showWarningMessage('No folder selected.'); return; }

    const folderPath = targetUri.fsPath;
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
        vscode.window.showWarningMessage('Selected path is not a directory.');
        return;
    }
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Formatting markdown files…' },
        async () => {
            const count = formatDirectoryRecursive(folderPath);
            vscode.window.showInformationMessage(`Typography: ${count} file(s) updated.`);
        }
    );
}

function formatDirectoryRecursive(dirPath: string): number {
    let count = 0;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            count += formatDirectoryRecursive(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const content   = fs.readFileSync(fullPath, 'utf-8');
            const formatted = updateTypography(content);
            if (content !== formatted) {
                fs.writeFileSync(fullPath, formatted, 'utf-8');
                count++;
            }
        }
    }
    return count;
}

// ─── Commands: merge ──────────────────────────────────────────────────────────

let mergeInProgress = false;

async function mergeCommand(outputTypes: OutputType[]) {
    if (mergeInProgress) { vscode.window.showWarningMessage('A merge is already in progress.'); return; }
    mergeInProgress = true;
    try {
        await doMerge(outputTypes);
    } finally {
        mergeInProgress = false;
    }
}

async function doMerge(outputTypes: OutputType[]) {
    const root = getWorkspaceRoot();
    if (!root) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

    const wsSettings   = readWorkspaceSettings(root);
    const translations = readTranslations(root);
    const cfg          = getEffectiveConfig(wsSettings);

    // Select languages to export
    let selectedLangs: LanguageConfig[];
    if (cfg.languages.length > 1) {
        const available = cfg.languages.filter(l => languageCanExport(root, cfg.storyFolder, l));
        if (available.length === 0) {
            vscode.window.showErrorMessage(`No language folders found in ${cfg.storyFolder}/`);
            return;
        }
        if (available.length === 1) {
            selectedLangs = available;
        } else {
            const items = [
                { label: 'All languages', description: available.map(l => l.code).join(', '), langs: available },
                ...available.map(l => ({ label: l.code, description: l.folderName, langs: [l] })),
            ];
            const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select language(s) to merge' });
            if (!picked) { return; }
            selectedLangs = picked.langs;
        }
    } else {
        selectedLangs = cfg.languages;
    }

    // Verify pandoc if needed
    if (outputTypes.some(t => t === 'docx' || t === 'epub' || t === 'pdf')) {
        try {
            await checkPandoc(cfg.pandocPath);
        } catch {
            vscode.window.showErrorMessage(
                'Pandoc is required for DOCX/EPUB/PDF export but was not found. ' +
                'Install it from https://pandoc.org or set bindery.pandocPath in settings.'
            );
            return;
        }
    }

    const formatLabel = outputTypes.map(t => t.toUpperCase()).join(' + ');
    const result = await vscode.window.withProgress<{ outputs: string[]; warnings: string[] }>(
        { location: vscode.ProgressLocation.Notification, title: `Bindery: Merging → ${formatLabel}…`, cancellable: false },
        async (progress) => {
            const allOutputs: string[]  = [];
            const allWarnings: string[] = [];
            for (let i = 0; i < selectedLangs.length; i++) {
                const lang = selectedLangs[i];
                progress.report({ message: `${lang.code} (${i + 1}/${selectedLangs.length})…` });
                try {
                    const options = buildMergeOptions(root, lang, outputTypes, wsSettings, translations);
                    const r       = await mergeBook(options);
                    allOutputs.push(...r.outputs);
                    allWarnings.push(...r.warnings.map(w => `${lang.code}: ${w}`));
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Merge failed for ${lang.code}: ${err.message}`);
                }
            }
            return { outputs: allOutputs, warnings: allWarnings };
        }
    );

    if (result.warnings.length > 0) {
        const preview = result.warnings.slice(0, 2).join(' | ');
        const more    = result.warnings.length > 2 ? ` (+${result.warnings.length - 2} more)` : '';
        vscode.window.showWarningMessage(`Merge completed with warnings: ${preview}${more}`);
    }
    if (result.outputs.length > 0) {
        const names  = result.outputs.map((p: string) => path.basename(p)).join(', ');
        const action = await vscode.window.showInformationMessage(`Merged → ${names}`, 'Open Folder');
        if (action === 'Open Folder') {
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path.dirname(result.outputs[0])));
        }
    }
}

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {

    // Formatting provider (used by VS Code's Format Document command)
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(
            { language: 'markdown', scheme: 'file' },
            new TypographyFormattingProvider()
        )
    );

    // Format-on-save — only fires for files inside the configured Story folder
    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument((event) => {
            if (event.document.languageId !== 'markdown') { return; }

            const root = getWorkspaceRoot();
            if (!root) { return; }

            const wsSettings = readWorkspaceSettings(root);
            const cfg        = getEffectiveConfig(wsSettings);
            if (!cfg.formatOnSave) { return; }
            if (!isInsideStoryFolder(event.document.uri.fsPath, root, cfg.storyFolder)) { return; }

            const original  = event.document.getText();
            const formatted = updateTypography(original);
            if (original === formatted) { return; }

            const fullRange = new vscode.Range(
                event.document.positionAt(0),
                event.document.positionAt(original.length)
            );
            event.waitUntil(Promise.resolve([vscode.TextEdit.replace(fullRange, formatted)]));
        })
    );

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('bindery.init',                    initWorkspaceCommand),
        vscode.commands.registerCommand('bindery.setupAI',                 setupAiCommand),
        vscode.commands.registerCommand('bindery.formatDocument',          formatDocumentCommand),
        vscode.commands.registerCommand('bindery.formatFolder',            formatFolderCommand),
        vscode.commands.registerCommand('bindery.mergeMarkdown',           () => mergeCommand(['md'])),
        vscode.commands.registerCommand('bindery.mergeDocx',               () => mergeCommand(['docx'])),
        vscode.commands.registerCommand('bindery.mergeEpub',               () => mergeCommand(['epub'])),
        vscode.commands.registerCommand('bindery.mergePdf',                () => mergeCommand(['pdf'])),
        vscode.commands.registerCommand('bindery.mergeAll',                () => mergeCommand(['md', 'docx', 'epub', 'pdf'])),
        vscode.commands.registerCommand('bindery.findProbableUsToUkWords', findProbableUsToUkWordsCommand),
        vscode.commands.registerCommand('bindery.addUkReplacement',        addTranslationCommand),
        vscode.commands.registerCommand('bindery.openTranslations',        openTranslationsCommand),
        vscode.commands.registerCommand('bindery.registerMcp',             () => registerMcpCommand(context)),
    );

    // LM tools (Copilot Chat)
    registerLmTools(context);

    // AI setup version check — prompt if generated files are out of date
    const root = getWorkspaceRoot();
    if (root && fs.existsSync(getSettingsPath(root))) {
        const installedVersion = readAiSetupVersion(root);
        if (installedVersion < AI_SETUP_VERSION) {
            vscode.window.showInformationMessage(
                'Bindery: AI assistant files may be out of date (skill templates were updated).',
                'Update now',
                'Dismiss'
            ).then(action => {
                if (action === 'Update now') {
                    vscode.commands.executeCommand('bindery.setupAI');
                }
            });
        }
    }

    // Status bar — shown when a markdown file is active
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text    = '$(book) Bindery';
    statusBar.tooltip = 'Bindery: Merge Chapters → All Formats';
    statusBar.command = 'bindery.mergeAll';
    context.subscriptions.push(statusBar);

    const updateStatusBar = () => {
        if (vscode.window.activeTextEditor?.document.languageId === 'markdown') {
            statusBar.show();
        } else {
            statusBar.hide();
        }
    };
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar));
    updateStatusBar();
}

export function deactivate() { }
