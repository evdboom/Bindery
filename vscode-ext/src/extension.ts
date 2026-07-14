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
import * as fs     from 'node:fs';
import * as path   from 'node:path'
import { execSync, spawnSync } from 'node:child_process'
import { updateTypography }                    from './format';
import {
    mergeBook, checkPandoc, getBuiltInUkReplacements,
    type LanguageConfig, type DialectConfig, type OutputType, type MergeOptions, type UkReplacement,
} from './merge';
import {
    readWorkspaceSettings, readTranslations,
    getSettingsPath, getTranslationsPath,
    getBookTitleForLang, getSubstitutionRules, getIgnoredWords,
    upsertSubstitutionRule, upsertGlossaryRule, addIgnoredWords,
    getDefaultLanguage, getDialectsForLanguage,
    type WorkspaceSettings, type TranslationsFile,
} from './workspace';
import {
    ALL_SKILLS,
    type AiTarget, type SkillTemplate,
} from './ai-setup';
import { registerLmTools, registerMcpCommand } from './mcp';
import { locateToolPath, clearLocateCache } from './tool-locate';

// ─── Known language presets ───────────────────────────────────────────────────

const KNOWN_LANGUAGES: Record<string, LanguageConfig> = {
    EN: { code: 'EN', folderName: 'EN', chapterWord: 'Chapter',   actPrefix: 'Act',  prologueLabel: 'Prologue', epilogueLabel: 'Epilogue', isDefault: true, dialects: [{ code: 'en-gb', label: 'British English' }] },
    NL: { code: 'NL', folderName: 'NL', chapterWord: 'Hoofdstuk', actPrefix: 'Deel', prologueLabel: 'Proloog',  epilogueLabel: 'Epiloog'   },
    FR: { code: 'FR', folderName: 'FR', chapterWord: 'Chapitre',  actPrefix: 'Acte', prologueLabel: 'Prologue', epilogueLabel: 'Épilogue'  },
    DE: { code: 'DE', folderName: 'DE', chapterWord: 'Kapitel',   actPrefix: 'Teil', prologueLabel: 'Prolog',   epilogueLabel: 'Epilog'    },
    ES: { code: 'ES', folderName: 'ES', chapterWord: 'Capítulo',  actPrefix: 'Acto', prologueLabel: 'Prólogo',  epilogueLabel: 'Epílogo'   },
    IT: { code: 'IT', folderName: 'IT', chapterWord: 'Capitolo',  actPrefix: 'Atto', prologueLabel: 'Prologo',  epilogueLabel: 'Epilogo'   },
    PT: { code: 'PT', folderName: 'PT', chapterWord: 'Capítulo',  actPrefix: 'Ato',  prologueLabel: 'Prólogo',  epilogueLabel: 'Epílogo'   },
    // UK retained for backward compatibility only — new projects use EN.dialects instead
    UK: { code: 'UK', folderName: 'UK', chapterWord: 'Chapter',   actPrefix: 'Act',  prologueLabel: 'Prologue', epilogueLabel: 'Epilogue'  },
};

const DEFAULT_LANGUAGE: LanguageConfig = KNOWN_LANGUAGES.EN;

// ─── VS Code config + workspace helpers ──────────────────────────────────────

function getVscConfig() {
    return vscode.workspace.getConfiguration('bindery');
}

function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

interface McpToolsForAi {
    toolHealth: (_root: string) => string;
    toolInitWorkspace: (_root: string, _args: { bookTitle?: string; author?: string; storyFolder?: string; targetAudience?: string }) => string;
    toolSetupAiFiles: (_root: string, _args: { targets?: string[]; skills?: string[]; overwrite?: boolean }) => string;
    writeBinderyCapabilitiesReadme: (_root: string) => void;
    toolNoteList: (_root: string, _args: { category?: string }) => string;
    toolNoteGet: (_root: string, _args: { path: string }) => string;
    toolNoteCreate: (_root: string, _args: { path: string; title?: string; content?: string; overwrite?: boolean }) => string;
    toolNoteAppend: (_root: string, _args: { path: string; content: string; heading?: string }) => string;
    toolCharacterList: (_root: string, _args: { name?: string }) => string;
    toolCharacterGet: (_root: string, _args: { name: string }) => string;
    toolCharacterCreate: (_root: string, _args: AuthoringCharacterInput) => string;
    toolCharacterUpdate: (_root: string, _args: AuthoringCharacterInput) => string;
    toolArcList: (_root: string, _args: { kind?: string }) => string;
    toolArcGet: (_root: string, _args: { path: string }) => string;
    toolArcCreate: (_root: string, _args: AuthoringArcInput) => string;
    toolArcUpdate: (_root: string, _args: AuthoringArcInput) => string;
    toolMemoryList: (_root: string) => string;
    toolMemoryAppend: (_root: string, _args: { file: string; title: string; content: string }) => string;
    toolMemoryCompact: (_root: string, _args: { file: string; compacted_content: string }) => string;
    toolChapterStatusGet: (_root: string) => string;
    toolChapterStatusUpdate: (_root: string, _args: { chapters: AuthoringChapterStatusEntry[] }) => string;
    toolSessionFocusGet: (_root: string, _args: { section?: string }) => string;
    toolSessionFocusUpdate: (_root: string, _args: { currentFocus?: string; nextActions?: string; openQuestions?: string; handoffNotes?: string; mode?: 'replace' | 'append' }) => string;
    toolInboxProcess: (_root: string) => string;
    toolInboxResolve: (_root: string, _args: { items: number[] }) => string;
}

interface AuthoringCharacterInput {
    name: string;
    role?: string;
    firstAppearance?: string;
    background?: string;
    continuityNotes?: string;
    indexNotes?: string;
    overwrite?: boolean;
}

interface AuthoringArcInput {
    path: string;
    title?: string;
    kind?: string;
    purpose?: string;
    majorBeats?: string;
    continuityRisks?: string;
    linkedChapters?: string;
    overwrite?: boolean;
}

interface AuthoringChapterStatusEntry {
    number: number;
    title: string;
    language: string;
    status: 'done' | 'in-progress' | 'draft' | 'planned' | 'needs-review';
    wordCount?: number;
    notes?: string;
}

function loadMcpToolsForAi(extensionPath: string): McpToolsForAi {
    const bundledPath = path.join(extensionPath, 'mcp-ts', 'out', 'tools');
    const devPath     = path.join(extensionPath, '..', 'mcp-ts', 'out', 'tools');
    const modulePath  = fs.existsSync(bundledPath + '.js') ? bundledPath : devPath;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic path needed for bundled/dev module loading
    return require(modulePath) as McpToolsForAi;
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
        pandocPath:      locateToolPath('pandoc',      vsc.get<string>('pandocPath')),
        libreOfficePath: locateToolPath('libreoffice', vsc.get<string>('libreOfficePath')),
    };
}

/** True if filePath is inside <root>/<storyFolder>/. */
function isInsideStoryFolder(filePath: string, root: string, storyFolder: string): boolean {
    // Normalize separators so Windows paths compare correctly
    const norm  = (p: string) => p.replaceAll('\\', '/');
    const story = norm(path.join(root, storyFolder));
    const file  = norm(filePath);
    return file.startsWith(story + '/');
}

function isUkLanguage(lang: LanguageConfig): boolean {
    const c = lang.code.trim().toUpperCase();
    return c === 'UK' || c === 'EN-GB';
}

/** True if the language has a story folder that exists on disk. */
function languageCanExport(root: string, storyFolder: string, lang: LanguageConfig): boolean {
    if (isUkLanguage(lang)) {
        // Legacy UK LanguageConfig reads from EN folder
        return fs.existsSync(path.join(root, storyFolder, 'EN'));
    }
    return fs.existsSync(path.join(root, storyFolder, lang.folderName));
}

// ─── Substitution tier helpers ────────────────────────────────────────────────
//
//  Tier 1 (built-in)  — UK_REPLACEMENTS array inside merge.ts, always applied first.
//  Tier 2 (general)   — bindery.generalSubstitutions in VS Code *user* settings.
//  Tier 3 (project)   — .bindery/translations.json → dialect entry (e.g. 'en-gb').
//
//  Later tiers win on conflict.

function getGeneralSubstitutions(): UkReplacement[] {
    const entries = getVscConfig().get<Array<{ from?: string; to?: string }>>('generalSubstitutions') ?? [];
    return entries
        .filter(e => e?.from?.trim() && e?.to?.trim())
        .map(e => ({ us: e.from!.trim().toLowerCase(), uk: e.to!.trim() }));
}

/**
 * Build the combined substitution list for a dialect export.
 * merge.ts applies tier 1 (built-ins) internally; this merges tiers 2 + 3.
 */
function buildCombinedSubstitutions(translations: TranslationsFile | null, dialectCode: string): UkReplacement[] {
    const general = getGeneralSubstitutions();
    const project = getSubstitutionRules(translations, dialectCode);
    const map = new Map<string, string>();
    for (const r of general) { map.set(r.us, r.uk); }
    for (const r of project) { map.set(r.us, r.uk); }   // project overrides general
    return Array.from(map.entries()).map(([us, uk]) => ({ us, uk }));
}

/**
 * Combined ignored-words from translations.json and legacy ukIgnoredWords setting.
 * dialectCode defaults to 'en-gb' here because findProbableUsToUkWords is UK-specific.
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

async function initWorkspaceCommand(context?: vscode.ExtensionContext) {
    const root = getWorkspaceRoot();
    if (!root) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

    const settingsPath = getSettingsPath(root);
    let existingSettings: WorkspaceSettings | undefined;
    if (fs.existsSync(settingsPath)) {
        const choice = await vscode.window.showQuickPick(
            [
                { label: 'Re-initialize', description: 'Merges updates into existing settings; existing values are pre-filled', value: true  as const },
                { label: 'Cancel',                                                                                               value: false as const },
            ],
            { placeHolder: '.bindery/settings.json already exists' }
        );
        if (!choice?.value) { return; }
        try { existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as WorkspaceSettings; }
        catch { /* corrupt — proceed as new */ }
    }

    const existingTitle = typeof existingSettings?.bookTitle === 'string' ? existingSettings.bookTitle : undefined;
    const title = await vscode.window.showInputBox({
        title:       'Bindery: Initialize (1/4)',
        prompt:      'Book title',
        placeHolder: 'e.g. The Hollow Road',
        value:       existingTitle,
    });
    if (title === undefined) { return; }

    const author = await vscode.window.showInputBox({
        title:       'Bindery: Initialize (2/4)',
        prompt:      'Author name',
        placeHolder: 'e.g. Jane Smith',
        value:       existingSettings?.author,
    });
    if (author === undefined) { return; }

    const storyFolder = await vscode.window.showInputBox({
        title:  'Bindery: Initialize (3/4)',
        prompt: 'Story folder name (relative to workspace root)',
        value:  existingSettings?.storyFolder ?? 'Story',
    });
    if (!storyFolder) { return; }

    const audience = await vscode.window.showInputBox({
        title:       'Bindery: Initialize (4/5)',
        prompt:      'Target audience (used for AI review feedback)',
        placeHolder: 'e.g. 12+, adults, 8-10',
        value:       existingSettings?.targetAudience,
    });
    if (audience === undefined) { return; }

    const currentFormatOnSave = existingSettings?.formatOnSave ?? false;
    const formatOption = await vscode.window.showQuickPick(
        currentFormatOnSave
            ? [{ label: 'Yes', value: true as const }, { label: 'No', value: false as const }]
            : [{ label: 'No',  value: false as const }, { label: 'Yes', value: true as const }],
        { title: 'Bindery: Initialize (5/5)', placeHolder: 'Auto-apply typography on save (Story folder only)?' }
    );
    if (!formatOption) { return; }

    const detectedLangs = detectLanguageFolders(path.join(root, storyFolder));
    const translationsPath = getTranslationsPath(root);

    if (!context) {
        vscode.window.showErrorMessage('Bindery initializer unavailable.');
        return;
    }

    let settings: WorkspaceSettings;
    try {
        const tools = loadMcpToolsForAi(context.extensionPath);
        tools.toolInitWorkspace(root, {
            ...(title    ? { bookTitle: title }         : {}),
            ...(author   ? { author }                   : {}),
            ...(audience ? { targetAudience: audience } : {}),
            storyFolder,
        });
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as WorkspaceSettings;
    } catch {
        const binderyFolder = path.join(root, '.bindery');
        const languages = detectedLangs.length > 0 ? detectedLangs : [DEFAULT_LANGUAGE];
        const slug = title.replaceAll(/[^a-zA-Z0-9]+/g, '_').replaceAll(/^_|_$/g, '') || 'Book';
        settings = {
            ...existingSettings,
            ...(title    ? { bookTitle: title }         : {}),
            ...(author   ? { author }                   : {}),
            ...(audience ? { targetAudience: audience } : {}),
            storyFolder,
            notesFolder: existingSettings?.notesFolder ?? 'Notes',
            arcFolder: existingSettings?.arcFolder ?? 'Arc',
            charactersFolder: existingSettings?.charactersFolder ?? 'Notes/Characters',
            sessionFile: existingSettings?.sessionFile ?? 'SESSION.md',
            preferencesFile: existingSettings?.preferencesFile ?? 'PREFERENCES.md',
            mergedOutputDir: existingSettings?.mergedOutputDir ?? 'Merged',
            mergeFilePrefix: existingSettings?.mergeFilePrefix ?? slug,
            formatOnSave: existingSettings?.formatOnSave ?? false,
            languages: existingSettings?.languages?.length ? existingSettings.languages : languages,
        };
        const writeIfMissing = (filePath: string, content: string): void => {
            if (fs.existsSync(filePath)) { return; }
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content, 'utf-8');
        };
        fs.mkdirSync(binderyFolder, { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
        writeIfMissing(translationsPath, JSON.stringify({ 'en-gb': { label: 'British English', type: 'substitution', sourceLanguage: 'en', rules: [], ignoredWords: [] } }, null, 2) + '\n');
        fs.mkdirSync(path.join(root, storyFolder, 'EN'), { recursive: true });
        fs.mkdirSync(path.join(root, 'Arc', 'Acts'), { recursive: true });
        fs.mkdirSync(path.join(root, 'Notes', 'Characters'), { recursive: true });
        fs.mkdirSync(path.join(root, '.bindery', 'memories', 'archive'), { recursive: true });
        writeIfMissing(path.join(root, 'SESSION.md'), `# Session — ${title || path.basename(root)}\n\n## Current Focus\n\n\n## Next Actions\n\n\n## Open Questions\n\n\n## Handoff Notes\n\n`);
        writeIfMissing(path.join(root, 'PREFERENCES.md'), `# Preferences — ${title || path.basename(root)}\n\n## Working Style\n\n\n## Writing Conventions\n\n\n## Review Preferences\n\n\n## Collaboration Notes\n\n`);
        writeIfMissing(path.join(root, 'Arc', 'Overall.md'), '# Overall Arc\n');
        writeIfMissing(path.join(root, 'Notes', 'Inbox.md'), '# Inbox\n');
        writeIfMissing(path.join(root, 'Notes', 'Characters', 'index.md'), '# Character Index\n');
        writeIfMissing(path.join(root, '.bindery', 'memories', 'global.md'), `# Global Memory - ${title || path.basename(root)}\n`);
        writeIfMissing(path.join(root, '.bindery', 'chapter-status.json'), JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString().slice(0, 10), chapters: [] }, null, 2) + '\n');
    }
    settings.formatOnSave = formatOption.value;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

    const sessionFile = typeof settings.sessionFile === 'string' ? settings.sessionFile : 'SESSION.md';
    const preferencesFile = typeof settings.preferencesFile === 'string' ? settings.preferencesFile : 'PREFERENCES.md';
    const gitAddCandidates = [
        '.bindery/',
        '.gitignore',
        sessionFile,
        preferencesFile,
        settings.storyFolder ?? 'Story',
        settings.arcFolder ?? 'Arc',
        settings.notesFolder ?? 'Notes',
        settings.charactersFolder ?? 'Notes/Characters',
    ];
    // Ensure git repo exists for version tracking
    let gitNote = '';
    if (!fs.existsSync(path.join(root, '.git'))) {
        try {
            execSync('git --version', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
            execSync('git init', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });

            // Create .gitignore if it doesn't exist
            const gitignorePath = path.join(root, '.gitignore');
            if (!fs.existsSync(gitignorePath)) {
                const outputDir = (settings.mergedOutputDir ?? 'Merged').replace(/\/+$/, '');
                fs.writeFileSync(gitignorePath, [
                    `${outputDir}/`,
                    '*.docx',
                    '*.epub',
                    '*.pdf',
                    'node_modules/',
                    '.bindery/proof-read-payload.md',
                    '',
                ].join('\n'), 'utf-8');
            }

            const gitAddPaths = gitAddCandidates.filter(rel => fs.existsSync(path.join(root, rel)));
            const gitAddResult = spawnSync('git', ['add', '--', ...gitAddPaths], { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
            if (gitAddResult.error) { throw gitAddResult.error; }
            if (gitAddResult.status !== 0) { throw new Error(gitAddResult.stderr || gitAddResult.stdout || 'git add failed'); }
            execSync('git commit -m "Bindery: initial setup"', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
            gitNote = ' Git repository initialized.';
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
        `Bindery workspace initialized.${langNote}${gitNote}`,
        'Open settings.json',
        'Open translations.json'
    );
    if (action === 'Open settings.json') {
        vscode.window.showTextDocument(await vscode.workspace.openTextDocument(settingsPath));
    } else if (action === 'Open translations.json') {
        vscode.window.showTextDocument(await vscode.workspace.openTextDocument(translationsPath));
    }
}

// ─── Command: Review markers ─────────────────────────────────────────────────
//
// Insert Bindery review markers around the cursor or a selection. The
// `get_review_text` MCP tool extracts text inside these markers as part of the
// next /review or /translation-review pass — useful when the author commits
// work-in-progress and continues on another machine.

const REVIEW_START_MARKER = '<!-- Bindery: Review start -->';
const REVIEW_STOP_MARKER  = '<!-- Bindery: Review stop -->';

/** Returns true if the file should accept Bindery review markers. */
function isMarkdownEditor(editor: vscode.TextEditor): boolean {
    return editor.document.languageId === 'markdown';
}

/**
 * Build the prefix/suffix needed so `marker` ends up on its own line.
 * If the cursor is mid-line, we prepend a newline; if the next character
 * is not already a newline (or EOF), we append one. That way the inserted
 * marker is always on its own line and matches the marker scanner regex.
 */
function lineBoundaryWrap(doc: vscode.TextDocument, pos: vscode.Position, marker: string): string {
    const atLineStart = pos.character === 0;
    const prefix = atLineStart ? '' : '\n';
    const atDocumentEnd = pos.line === doc.lineCount - 1
        && pos.character === doc.lineAt(pos.line).text.length;
    const nextChar = atDocumentEnd ? '' : doc.getText(new vscode.Range(pos, pos.translate(0, 1)));
    const suffix = nextChar === '\n' || nextChar === '' ? '' : '\n';
    return `${prefix}${marker}${suffix}`;
}

async function startReviewMarkerCommand() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('Bindery: open a markdown file first.'); return; }
    if (!isMarkdownEditor(editor)) {
        vscode.window.showWarningMessage('Bindery: review markers are only valid in markdown files.');
        return;
    }

    const sel = editor.selection;
    await editor.edit(eb => {
        if (sel.isEmpty) {            
            eb.insert(sel.active, lineBoundaryWrap(editor.document, sel.active, REVIEW_START_MARKER));
        } else {
            // Wrap selection. Snap markers to line boundaries so they match
            // the marker scanner regex even if the selection starts/ends
            // mid-line.
            const text   = editor.document.getText(sel);
            const startWrap = lineBoundaryWrap(editor.document, sel.start, REVIEW_START_MARKER);
            const stopWrap  = lineBoundaryWrap(editor.document, sel.end,   REVIEW_STOP_MARKER);
            eb.replace(sel, `${startWrap}${text}${stopWrap}`);        
        }
    });
    vscode.window.setStatusBarMessage(
        sel.isEmpty ? 'Bindery: review-start marker inserted.' : 'Bindery: selection wrapped in review markers.',
        3000
    );
}

async function stopReviewMarkerCommand() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('Bindery: open a markdown file first.'); return; }
    if (!isMarkdownEditor(editor)) {
        vscode.window.showWarningMessage('Bindery: review markers are only valid in markdown files.');
        return;
    }

    const sel = editor.selection;
    await editor.edit(eb => {
        eb.insert(sel.active, lineBoundaryWrap(editor.document, sel.active, REVIEW_STOP_MARKER));
    });
    vscode.window.setStatusBarMessage('Bindery: review-stop marker inserted.', 3000);
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

// ─── Command: Add dialect rule ────────────────────────────────────────────────

async function addDialectCommand() {
    const root   = getWorkspaceRoot();
    const editor = vscode.window.activeTextEditor;
    const selected = editor && !editor.selection.isEmpty
        ? editor.document.getText(editor.selection).trim()
        : '';

    if (!root) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

    const wsSettings = readWorkspaceSettings(root);

    // Auto-detect source language from active file path
    let sourceLang: LanguageConfig | undefined;
    if (editor) {
        const sf   = wsSettings?.storyFolder ?? 'Story';
        const file = editor.document.uri.fsPath.replaceAll('\\', '/');
        const base = path.join(root, sf).replaceAll('\\', '/');
        if (file.startsWith(base + '/')) {
            const folderName = file.slice(base.length + 1).split('/')[0];
            sourceLang = wsSettings?.languages?.find(
                l => l.folderName.toUpperCase() === folderName?.toUpperCase()
            );
        }
    }
    sourceLang ??= getDefaultLanguage(wsSettings);

    if (!sourceLang) { vscode.window.showErrorMessage('No language configured. Run Bindery: Initialize Workspace first.'); return; }

    const dialects = getDialectsForLanguage(wsSettings, sourceLang.code);
    if (dialects.length === 0) {
        vscode.window.showErrorMessage(
            `Language ${sourceLang.code} has no dialects configured in settings.json. ` +
            `Add dialects[] to this language entry.`
        );
        return;
    }

    // Pick dialect (auto-select if only one)
    let dialect: DialectConfig;
    if (dialects.length === 1) {
        dialect = dialects[0];
    } else {
        const picked = await vscode.window.showQuickPick(
            dialects.map(d => ({ label: d.label ?? d.code, description: `key: ${d.code}`, dialect: d })),
            { placeHolder: `Dialect for ${sourceLang.code}` }
        );
        if (!picked) { return; }
        dialect = picked.dialect;
    }

    const fromWord = await vscode.window.showInputBox({
        title:       `Add Dialect Rule (${sourceLang.code} → ${dialect.label ?? dialect.code})`,
        prompt:      `${sourceLang.code} word`,
        value:       selected,
        placeHolder: 'e.g. airplane',
    });
    if (!fromWord) { return; }

    const suggested = suggestUkSpelling(fromWord) ?? '';
    const toWord = await vscode.window.showInputBox({
        title:       `Add Dialect Rule — ${dialect.label ?? dialect.code} form`,
        prompt:      `${dialect.label ?? dialect.code} word`,
        value:       suggested,
        placeHolder: 'e.g. aeroplane',
    });
    if (!toWord) { return; }

    const scope = await vscode.window.showQuickPick(
        [
            { label: 'This project only', description: 'Saved to .bindery/translations.json', value: 'project' as const },
            { label: 'All projects',      description: 'Saved to your VS Code user settings', value: 'general' as const },
        ],
        { placeHolder: 'Where should this rule be saved?' }
    );
    if (!scope) { return; }

    if (scope.value === 'project') {
        upsertSubstitutionRule(root, dialect.code, { from: fromWord.toLowerCase(), to: toWord });
        vscode.window.showInformationMessage(`Dialect rule saved: ${fromWord.toLowerCase()} → ${toWord} [${dialect.code}]`);
    } else {
        await upsertGeneralSubstitution({ from: fromWord.toLowerCase(), to: toWord });
        vscode.window.showInformationMessage(`Dialect rule saved to user settings: ${fromWord.toLowerCase()} → ${toWord}`);
    }
}

// ─── Command: Add translation (glossary) ─────────────────────────────────────

async function addTranslationCommand() {
    const root = getWorkspaceRoot();
    if (!root) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

    const editor   = vscode.window.activeTextEditor;
    const selected = editor && !editor.selection.isEmpty
        ? editor.document.getText(editor.selection).trim()
        : '';

    const wsSettings  = readWorkspaceSettings(root);
    const sourceLang  = getDefaultLanguage(wsSettings);
    const targetLangs = (wsSettings?.languages ?? []).filter(
        l => !l.isDefault && (l.code !== sourceLang?.code)
    );

    if (!sourceLang) { vscode.window.showErrorMessage('No default language configured. Run Bindery: Initialize Workspace first.'); return; }
    if (targetLangs.length === 0) {
        vscode.window.showErrorMessage('No target languages configured. Use Bindery: Add Language to add one.');
        return;
    }

    // Pick target language
    let targetLang: LanguageConfig;
    if (targetLangs.length === 1) {
        targetLang = targetLangs[0];
    } else {
        const picked = await vscode.window.showQuickPick(
            targetLangs.map(l => ({ label: l.code, description: l.folderName, lang: l })),
            { placeHolder: `Translate from ${sourceLang.code} to…` }
        );
        if (!picked) { return; }
        targetLang = picked.lang;
    }

    const fromWord = await vscode.window.showInputBox({
        title:       `Add Glossary Entry (${sourceLang.code} → ${targetLang.code})`,
        prompt:      `${sourceLang.code} word or term`,
        value:       selected,
        placeHolder: 'e.g. the Flux',
    });
    if (!fromWord) { return; }

    const toWord = await vscode.window.showInputBox({
        title:       `Add Glossary Entry — ${targetLang.code} form`,
        prompt:      `${targetLang.code} equivalent`,
        placeHolder: 'e.g. de Flux',
    });
    if (!toWord) { return; }

    const langKey   = targetLang.code.toLowerCase();
    const langLabel = targetLang.folderName;
    upsertGlossaryRule(root, langKey, langLabel, sourceLang.code, { from: fromWord, to: toWord });
    vscode.window.showInformationMessage(`Glossary entry saved: ${fromWord} → ${toWord} [${langKey}]`);
}

// ─── Command: Add language ────────────────────────────────────────────────────

async function addLanguageCommand() {
    const root = getWorkspaceRoot();
    if (!root) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

    const wsSettings  = readWorkspaceSettings(root);
    const sourceLang  = getDefaultLanguage(wsSettings) ?? { folderName: 'EN', code: 'EN', chapterWord: 'Chapter', actPrefix: 'Act', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue' };
    const storyFolder = wsSettings?.storyFolder ?? 'Story';

    const code = await vscode.window.showInputBox({
        title:       'Bindery: Add Language (1/6) — Language code',
        prompt:      'Short code (2–3 uppercase letters)',
        placeHolder: 'FR  NL  DE  ES  IT  PT  …',
        validateInput: v => /^[A-Za-z]{2,3}$/.test(v.trim()) ? undefined : 'Enter 2–3 letters',
    });
    if (!code?.trim()) { return; }
    const upper = code.trim().toUpperCase();

    const preset = KNOWN_LANGUAGES[upper];

    const folderName = await vscode.window.showInputBox({
        title:       'Bindery: Add Language (2/6) — Folder name',
        prompt:      'Subfolder under Story/ for this language',
        value:       preset?.folderName ?? upper,
    });
    if (!folderName?.trim()) { return; }

    const chapterWord = await vscode.window.showInputBox({
        title:       'Bindery: Add Language (3/6) — Chapter word',
        prompt:      'Word used for "Chapter" in this language',
        value:       preset?.chapterWord ?? 'Chapter',
    });
    if (!chapterWord?.trim()) { return; }

    const actPrefix = await vscode.window.showInputBox({
        title:       'Bindery: Add Language (4/6) — Act prefix',
        prompt:      'Word used for "Act" in this language',
        value:       preset?.actPrefix ?? 'Act',
    });
    if (!actPrefix?.trim()) { return; }

    const prologueLabel = await vscode.window.showInputBox({
        title:       'Bindery: Add Language (5/6) — Prologue label',
        value:       preset?.prologueLabel ?? 'Prologue',
    });
    if (!prologueLabel?.trim()) { return; }

    const epilogueLabel = await vscode.window.showInputBox({
        title:       'Bindery: Add Language (6/6) — Epilogue label',
        value:       preset?.epilogueLabel ?? 'Epilogue',
    });
    if (!epilogueLabel?.trim()) { return; }

    const newLang: LanguageConfig = {
        code:          upper,
        folderName:    folderName.trim(),
        chapterWord:   chapterWord.trim(),
        actPrefix:     actPrefix.trim(),
        prologueLabel: prologueLabel.trim(),
        epilogueLabel: epilogueLabel.trim(),
    };

    // Update settings.json
    const existing  = readWorkspaceSettings(root);
    const languages = [...(existing?.languages ?? [sourceLang])];
    const dupIdx = languages.findIndex(l => l.code.toUpperCase() === upper);
    if (dupIdx >= 0) {
        const overwrite = await vscode.window.showQuickPick(
            [{ label: 'Update existing', value: true as const }, { label: 'Cancel', value: false as const }],
            { placeHolder: `Language ${upper} already exists in settings.json` }
        );
        if (!overwrite?.value) { return; }
        languages[dupIdx] = newLang;
    } else {
        languages.push(newLang);
    }

    const settingsPath = getSettingsPath(root);
    let rawSettings: Record<string, unknown> = {};
    try { rawSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>; } catch { /* new */ }
    rawSettings['languages'] = languages;
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(rawSettings, null, 2) + '\n', 'utf-8');

    // Mirror folder structure from source language with stub files
    const sourceDir = path.join(root, storyFolder, sourceLang.folderName);
    const targetDir = path.join(root, storyFolder, newLang.folderName);
    fs.mkdirSync(targetDir, { recursive: true });

    let stubCount = 0;
    if (fs.existsSync(sourceDir)) {
        const createStubs = (srcDir: string, dstDir: string) => {
            fs.mkdirSync(dstDir, { recursive: true });
            for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
                const srcPath = path.join(srcDir, entry.name);
                const dstPath = path.join(dstDir, entry.name);
                if (entry.isDirectory()) {
                    createStubs(srcPath, dstPath);
                } else if (entry.isFile() && entry.name.endsWith('.md')) {
                    if (!fs.existsSync(dstPath)) {
                        // Read source H1 for stub header
                        const src = fs.readFileSync(srcPath, 'utf-8');
                        const h1  = /^#\s+(.+)/m.exec(src);
                        const title = h1 ? h1[1].trim() : path.basename(entry.name, '.md');
                        fs.writeFileSync(dstPath, `# [Untranslated] ${title}\n`, 'utf-8');
                        stubCount++;
                    }
                }
            }
        };
        createStubs(sourceDir, targetDir);
    }

    vscode.window.showInformationMessage(
        `Added language ${upper} to settings.json. Created ${stubCount} stub file(s) in Story/${newLang.folderName}/.`
    );
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

// ─── Command: Quick actions (status-bar ribbon entry point) ─────────────────

async function quickActionsCommand() {
    const picked = await vscode.window.showQuickPick(
        [
            { label: 'Merge chapters → All formats', command: 'bindery.mergeAll' },
            { label: 'Merge chapters → Markdown', command: 'bindery.mergeMarkdown' },
            { label: 'Merge chapters → DOCX', command: 'bindery.mergeDocx' },
            { label: 'Merge chapters → EPUB', command: 'bindery.mergeEpub' },
            { label: 'Merge chapters → PDF', command: 'bindery.mergePdf' },
            { label: 'Format document', command: 'bindery.formatDocument' },
            { label: 'Format folder', command: 'bindery.formatFolder' },
            { label: 'Setup AI assistant files', command: 'bindery.setupAI' },
            { label: 'Find probable US to UK words', command: 'bindery.findProbableUsToUkWords' },
            { label: 'Add dialect rule', command: 'bindery.addDialect' },
            { label: 'Add translation (glossary)', command: 'bindery.addTranslation' },
            { label: 'Add language', command: 'bindery.addLanguage' },
            { label: 'Open translations.json', command: 'bindery.openTranslations' },
            { label: 'Initialize workspace', command: 'bindery.init' },
            { label: 'Register MCP server', command: 'bindery.registerMcp' },
        ],
        {
            title: 'Bindery quick actions',
            placeHolder: 'Choose an action',
        }
    );
    if (!picked) { return; }
    await vscode.commands.executeCommand(picked.command);
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

function buildMergeOptions(
    root:         string,
    lang:         LanguageConfig,
    outputTypes:  OutputType[],
    wsSettings:   WorkspaceSettings | null,
    translations: TranslationsFile | null,
    dialectCode?: string,
): MergeOptions {
    const cfg = getEffectiveConfig(wsSettings);
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
        ukReplacements:  dialectCode ? buildCombinedSubstitutions(translations, dialectCode) : undefined,
        dialectCode,
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
    { label: '/review',     description: 'Chapter review — language, arc, age-appropriateness',          value: 'review'     },
    { label: '/brainstorm', description: 'Generate plot / character / scene ideas',                      value: 'brainstorm' },
    { label: '/memory',     description: 'Update memory files and compact if needed',                    value: 'memory'     },
    { label: '/translate',  description: 'Assisted chapter translation',                                 value: 'translate'  },
    { label: '/translation-review', description: 'Review hand-crafted translation against source text',  value: 'translation-review' },
    { label: '/status',     description: 'Book progress snapshot',                                       value: 'status'     },
    { label: '/continuity', description: 'Cross-check chapter for consistency errors',                   value: 'continuity' },
    { label: '/read-aloud', description: 'Reading-aloud test for a chapter or passage',                  value: 'read-aloud' },
    { label: '/read-in',    description: 'Load context and get your bearings at the start of a session', value: 'read-in'    },
    { label: '/proof-read', description: 'Multi-perspective proofread with reader and author personas',  value: 'proof-read' },
    { label: '/plan-beats',      description: 'Create or refine a chapter or scene beatmap',                  value: 'plan-beats'      },
    { label: '/character-setup', description: 'Build or update a structured character profile',                value: 'character-setup' },
];

async function setupAiCommand(context?: vscode.ExtensionContext) {
    const root = getWorkspaceRoot();
    if (!root) { vscode.window.showErrorMessage('No workspace folder open.'); return; }

    const wsSettings = readWorkspaceSettings(root);
    if (!wsSettings) {
        const init = await vscode.window.showWarningMessage(
            'No .bindery/settings.json found. Run "Bindery: Initialize Workspace" first.',
            'Initialize now'
        );
        if (init) { await initWorkspaceCommand(context); }
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
            const current = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            const updated  = { ...current, ...settings };
            fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
        } catch { /* non-fatal */ }
    }

    // Select AI targets — pre-select previously saved choices
    const savedTargets = new Set(wsSettings.aiTargets ?? []);
    const targetItems = AI_TARGET_ITEMS.map(item => ({
        ...item,
        picked: savedTargets.has(item.value),
    }));
    const targetPicks = await vscode.window.showQuickPick(targetItems, {
        canPickMany:  true,
        placeHolder:  'Select AI assistants to set up',
    });
    if (!targetPicks || targetPicks.length === 0) { return; }
    const targets = targetPicks.map(p => p.value);

    // Select skills (only for Claude target) — pre-select previously saved choices
    let skills: SkillTemplate[] = ALL_SKILLS;
    if (targets.includes('claude')) {
        const savedSkills = new Set(wsSettings.aiSkills ?? []);
        const skillItems = SKILL_ITEMS.map(item => ({
            ...item,
            picked: savedSkills.has(item.value),
        }));
        const skillPicks = await vscode.window.showQuickPick(skillItems, {
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

    // Generate using MCP implementation so VS Code and MCP workflows stay aligned.
    if (!context) {
        vscode.window.showErrorMessage('Bindery setup error: missing extension context.');
        return;
    }

    let raw = '';
    try {
        const tools = loadMcpToolsForAi(context.extensionPath);
        raw = tools.toolSetupAiFiles(root, {
            targets,
            skills,
            overwrite: overwritePick.value,
        });
    } catch (e: unknown) {
        vscode.window.showErrorMessage(`Bindery AI setup failed: ${e instanceof Error ? e.message : String(e)}`);
        return;
    }

    try {
        const parsed = JSON.parse(raw) as {
            regenerated_files?: string[];
            skipped_files?: string[];
            skill_files?: { reupload_required?: string[] };
        };

        const regenerated = parsed.regenerated_files ?? [];
        const skipped = parsed.skipped_files ?? [];
        const reuploadSkillFiles = parsed.skill_files?.reupload_required ?? [];

        const summary: string[] = [];
        if (regenerated.length > 0) {
            summary.push(`Regenerated: ${regenerated.join(', ')}`);
        }
        if (skipped.length > 0) {
            summary.push(`Skipped (up-to-date): ${skipped.join(', ')}`);
        }

        const base = summary.length > 0 ? summary.join(' | ') : 'No files changed.';
        const suffix = reuploadSkillFiles.length > 0
            ? ` If you use Claude Desktop skills, re-upload these SKILL.md files: ${reuploadSkillFiles.join(', ')}.`
            : '';
        vscode.window.showInformationMessage(base + suffix);
    } catch {
        vscode.window.showInformationMessage(raw || 'AI files setup completed.');
    }
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
        () => {
            const count = formatDirectoryRecursive(folderPath);
            vscode.window.showInformationMessage(`Typography: ${count} file(s) updated.`);
            return Promise.resolve();
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
                // Base language export
                try {
                    const options = buildMergeOptions(root, lang, outputTypes, wsSettings, translations);
                    const r       = await mergeBook(options);
                    allOutputs.push(...r.outputs);
                    allWarnings.push(...r.warnings.map(w => `${lang.code}: ${w}`));
                } catch (err: unknown) {
                    vscode.window.showErrorMessage(`Merge failed for ${lang.code}: ${err instanceof Error ? err.message : String(err)}`);
                }
                // Dialect exports — always run alongside parent language
                for (const dialect of lang.dialects ?? []) {
                    progress.report({ message: `${lang.code} → ${dialect.code}…` });
                    try {
                        const dOptions = buildMergeOptions(root, lang, outputTypes, wsSettings, translations, dialect.code);
                        const dr       = await mergeBook(dOptions);
                        allOutputs.push(...dr.outputs);
                        allWarnings.push(...dr.warnings.map(w => `${dialect.code}: ${w}`));
                    } catch (err: unknown) {
                        vscode.window.showErrorMessage(`Merge failed for dialect ${dialect.code}: ${err instanceof Error ? err.message : String(err)}`);
                    }
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

// ─── Commands: authoring tool wrappers ───────────────────────────────────────

function requireWorkspaceRoot(): string | undefined {
    const root = getWorkspaceRoot();
    if (!root) { vscode.window.showErrorMessage('No workspace folder open.'); return undefined; }
    return root;
}

async function showAuthoringResult(title: string, result: string): Promise<void> {
    const trimmed = result.trim();
    const content = (trimmed || '(no output)') + '\n';
    if (trimmed.length > 500 || trimmed.includes('\n')) {
        const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
        await vscode.window.showTextDocument(doc, { preview: true });
        return;
    }
    vscode.window.showInformationMessage(`Bindery: ${title}: ${trimmed || '(no output)'}`);
}

async function runAuthoringCommand(
    context: vscode.ExtensionContext,
    title: string,
    callback: (_root: string, _tools: McpToolsForAi) => Promise<string | undefined> | string | undefined,
): Promise<void> {
    const root = requireWorkspaceRoot();
    if (!root) { return; }
    try {
        const result = await callback(root, loadMcpToolsForAi(context.extensionPath));
        if (result !== undefined) { await showAuthoringResult(title, result); }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Bindery: ${title} failed: ${message}`);
    }
}

async function promptRequired(title: string, prompt: string, value = ''): Promise<string | undefined> {
    const result = await vscode.window.showInputBox({ title, prompt, value });
    if (result === undefined) { return undefined; }
    const trimmed = result.trim();
    if (!trimmed) {
        vscode.window.showWarningMessage(`Bindery: ${prompt} is required.`);
        return undefined;
    }
    return trimmed;
}

async function promptOptional(title: string, prompt: string, value = ''): Promise<string | null | undefined> {
    const result = await vscode.window.showInputBox({ title, prompt, value });
    if (result === undefined) { return null; }
    return result.trim() || undefined;
}

async function promptCharacterInput(title: string, update: boolean): Promise<AuthoringCharacterInput | undefined> {
    const name = await promptRequired(title, 'Character name');
    if (!name) { return undefined; }
    const role = await promptOptional(title, 'Role (optional)');
    if (role === null) { return undefined; }
    const firstAppearance = await promptOptional(title, 'First appearance (optional)');
    if (firstAppearance === null) { return undefined; }
    const background = await promptOptional(title, 'Background or notes (optional)');
    if (background === null) { return undefined; }
    let continuityNotes: string | undefined;
    if (update) {
        const rawContinuityNotes = await promptOptional(title, 'Continuity notes (optional)');
        if (rawContinuityNotes === null) { return undefined; }
        continuityNotes = rawContinuityNotes;
    }
    return { name, role, firstAppearance, background, continuityNotes };
}

async function promptArcInput(title: string, update: boolean): Promise<AuthoringArcInput | undefined> {
    const arcPath = await promptRequired(title, 'Arc path relative to Arc folder', update ? '' : 'Acts/Act_I.md');
    if (!arcPath) { return undefined; }
    const arcTitle = await promptOptional(title, 'Title (optional)');
    if (arcTitle === null) { return undefined; }
    const kindPick = await vscode.window.showQuickPick(
        [
            { label: 'overall' },
            { label: 'act' },
            { label: 'chapter' },
            { label: 'thread' },
            { label: 'custom' },
            { label: 'Skip', description: 'Leave kind unchanged/empty' },
        ],
        { title, placeHolder: 'Arc kind' }
    );
    if (!kindPick) { return undefined; }
    const purpose = await promptOptional(title, 'Purpose (optional)');
    if (purpose === null) { return undefined; }
    const majorBeats = await promptOptional(title, 'Major beats (optional)');
    if (majorBeats === null) { return undefined; }
    let continuityRisks: string | undefined;
    if (update) {
        const rawContinuityRisks = await promptOptional(title, 'Continuity risks (optional)');
        if (rawContinuityRisks === null) { return undefined; }
        continuityRisks = rawContinuityRisks;
    }
    return {
        path: arcPath,
        title: arcTitle,
        kind: kindPick.label === 'Skip' ? undefined : kindPick.label,
        purpose,
        majorBeats,
        continuityRisks,
    };
}

async function promptChapterStatusEntry(title: string): Promise<AuthoringChapterStatusEntry | undefined> {
    const chapterNumberRaw = await promptRequired(title, 'Chapter number');
    if (!chapterNumberRaw) { return undefined; }
    const chapterNumber = Number(chapterNumberRaw);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 0) {
        vscode.window.showWarningMessage('Bindery: chapter number must be a non-negative integer.');
        return undefined;
    }
    const chapterTitle = await promptRequired(title, 'Chapter title');
    if (!chapterTitle) { return undefined; }
    const languageResult = await promptOptional(title, 'Language code', 'EN');
    if (languageResult === null) { return undefined; }
    const language = languageResult ?? 'EN';
    const statusPick = await vscode.window.showQuickPick(
        [
            { label: 'done' as const },
            { label: 'in-progress' as const },
            { label: 'needs-review' as const },
            { label: 'draft' as const },
            { label: 'planned' as const },
        ],
        { title, placeHolder: 'Chapter status' }
    );
    if (!statusPick) { return undefined; }
    const wordCountRaw = await promptOptional(title, 'Word count (optional)');
    if (wordCountRaw === null) { return undefined; }
    const notes = await promptOptional(title, 'Notes (optional)');
    if (notes === null) { return undefined; }
    let wordCount: number | undefined;
    if (wordCountRaw) {
        const parsedWordCount = Number(wordCountRaw);
        if (!Number.isInteger(parsedWordCount) || parsedWordCount < 0) {
            vscode.window.showWarningMessage('Bindery: word count must be a non-negative integer.');
            return undefined;
        }
        wordCount = parsedWordCount;
    }
    return { number: chapterNumber, title: chapterTitle, language, status: statusPick.label, wordCount, notes };
}

async function noteListCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Note List', (_root, tools) => tools.toolNoteList(_root, {}));
}

async function noteGetCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Note Get', async (root, tools) => {
        const notePath = await promptRequired('Bindery: Get Note', 'Note path relative to Notes folder');
        return notePath ? tools.toolNoteGet(root, { path: notePath }) : undefined;
    });
}

async function noteCreateCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Note Create', async (root, tools) => {
        const notePath = await promptRequired('Bindery: Create Note', 'Note path relative to Notes folder', 'Inbox.md');
        if (!notePath) { return undefined; }
        const title = await promptOptional('Bindery: Create Note', 'Title (optional)');
        if (title === null) { return undefined; }
        const content = await promptOptional('Bindery: Create Note', 'Initial content (optional)');
        if (content === null) { return undefined; }
        return tools.toolNoteCreate(root, { path: notePath, title, content });
    });
}

async function noteAppendCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Note Append', async (root, tools) => {
        const notePath = await promptRequired('Bindery: Append Note', 'Note path relative to Notes folder', 'Inbox.md');
        if (!notePath) { return undefined; }
        const heading = await promptOptional('Bindery: Append Note', 'Heading (optional)');
        if (heading === null) { return undefined; }
        const content = await promptRequired('Bindery: Append Note', 'Content to append');
        return content ? tools.toolNoteAppend(root, { path: notePath, heading, content }) : undefined;
    });
}

async function characterListCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Character List', (_root, tools) => tools.toolCharacterList(_root, {}));
}

async function characterGetCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Character Get', async (root, tools) => {
        const name = await promptRequired('Bindery: Get Character', 'Character name');
        return name ? tools.toolCharacterGet(root, { name }) : undefined;
    });
}

async function characterCreateCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Character Create', async (root, tools) => {
        const input = await promptCharacterInput('Bindery: Create Character', false);
        return input ? tools.toolCharacterCreate(root, input) : undefined;
    });
}

async function characterUpdateCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Character Update', async (root, tools) => {
        const input = await promptCharacterInput('Bindery: Update Character', true);
        return input ? tools.toolCharacterUpdate(root, input) : undefined;
    });
}

async function arcListCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Arc List', (_root, tools) => tools.toolArcList(_root, {}));
}

async function arcGetCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Arc Get', async (root, tools) => {
        const arcPath = await promptRequired('Bindery: Get Arc', 'Arc path relative to Arc folder');
        return arcPath ? tools.toolArcGet(root, { path: arcPath }) : undefined;
    });
}

async function arcCreateCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Arc Create', async (root, tools) => {
        const input = await promptArcInput('Bindery: Create Arc', false);
        return input ? tools.toolArcCreate(root, input) : undefined;
    });
}

async function arcUpdateCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Arc Update', async (root, tools) => {
        const input = await promptArcInput('Bindery: Update Arc', true);
        return input ? tools.toolArcUpdate(root, input) : undefined;
    });
}

async function memoryListCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Memory List', (_root, tools) => tools.toolMemoryList(_root));
}

async function memoryAppendCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Memory Append', async (root, tools) => {
        const file = await promptRequired('Bindery: Append Memory', 'Memory file', 'global.md');
        if (!file) { return undefined; }
        const title = await promptRequired('Bindery: Append Memory', 'Session title');
        if (!title) { return undefined; }
        const content = await promptRequired('Bindery: Append Memory', 'Memory content');
        return content ? tools.toolMemoryAppend(root, { file, title, content }) : undefined;
    });
}

async function memoryCompactCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Memory Compact', async (root, tools) => {
        const file = await promptRequired('Bindery: Compact Memory', 'Memory file', 'global.md');
        if (!file) { return undefined; }
        const compactedContent = await promptRequired('Bindery: Compact Memory', 'Compacted content');
        return compactedContent ? tools.toolMemoryCompact(root, { file, compacted_content: compactedContent }) : undefined;
    });
}

async function chapterStatusGetCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Chapter Status', (_root, tools) => tools.toolChapterStatusGet(_root));
}

async function chapterStatusUpdateCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Update Chapter Status', async (root, tools) => {
        const entry = await promptChapterStatusEntry('Bindery: Update Chapter Status');
        return entry ? tools.toolChapterStatusUpdate(root, { chapters: [entry] }) : undefined;
    });
}

const SESSION_FOCUS_SECTIONS = [
    { label: 'Current Focus',  key: 'currentFocus'  as const },
    { label: 'Next Actions',   key: 'nextActions'   as const },
    { label: 'Open Questions', key: 'openQuestions' as const },
    { label: 'Handoff Notes',  key: 'handoffNotes'  as const },
];

async function sessionFocusShowCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Session Focus', async (root, tools) => {
        const pick = await vscode.window.showQuickPick(
            [{ label: 'Whole file', section: undefined as string | undefined },
             ...SESSION_FOCUS_SECTIONS.map(s => ({ label: s.label, section: s.label }))],
            { placeHolder: 'Show which part of the session file?' }
        );
        if (!pick) { return undefined; }
        return tools.toolSessionFocusGet(root, { section: pick.section });
    });
}

async function sessionFocusUpdateCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Update Session Focus', async (root, tools) => {
        const sectionPick = await vscode.window.showQuickPick(
            SESSION_FOCUS_SECTIONS.map(s => ({ label: s.label, key: s.key })),
            { placeHolder: 'Which section to update?' }
        );
        if (!sectionPick) { return undefined; }
        const content = await promptRequired('Bindery: Update Session Focus', `New content for ${sectionPick.label}`);
        if (!content) { return undefined; }
        const modePick = await vscode.window.showQuickPick(
            [{ label: 'Replace', value: 'replace' as const }, { label: 'Append', value: 'append' as const }],
            { placeHolder: `Replace or append ${sectionPick.label}?` }
        );
        if (!modePick) { return undefined; }
        return tools.toolSessionFocusUpdate(root, { [sectionPick.key]: content, mode: modePick.value });
    });
}

async function sessionFocusAppendHandoffCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Append Handoff Note', async (root, tools) => {
        const content = await promptRequired('Bindery: Append Handoff Note', 'Handoff note to append');
        return content ? tools.toolSessionFocusUpdate(root, { handoffNotes: content, mode: 'append' }) : undefined;
    });
}

async function inboxProcessCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Process Inbox', (root, tools) => tools.toolInboxProcess(root));
}

async function inboxResolveCommand(context: vscode.ExtensionContext): Promise<void> {
    await runAuthoringCommand(context, 'Resolve Inbox Items', async (root, tools) => {
        const raw = await promptRequired('Bindery: Resolve Inbox Items', 'Item numbers to remove (comma-separated)');
        if (!raw) { return undefined; }
        const items = raw.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
        if (items.length === 0) {
            vscode.window.showWarningMessage('Bindery: enter one or more item numbers, e.g. "1, 3".');
            return undefined;
        }
        return tools.toolInboxResolve(root, { items });
    });
}

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
    const subscriptions: vscode.Disposable[] = [];

    // Clear tool-path auto-detect cache whenever the user changes pandoc/libreoffice settings.
    subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('bindery.pandocPath') || e.affectsConfiguration('bindery.libreOfficePath')) {
                clearLocateCache();
            }
        })
    );

    // Formatting provider (used by VS Code's Format Document command)
    subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(
            { language: 'markdown', scheme: 'file' },
            new TypographyFormattingProvider()
        )
    );

    // Format-on-save — only fires for files inside the configured Story folder
    subscriptions.push(
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
    subscriptions.push(
        vscode.commands.registerCommand('bindery.init',                    () => initWorkspaceCommand(context)),
        vscode.commands.registerCommand('bindery.setupAI',                 () => setupAiCommand(context)),
        vscode.commands.registerCommand('bindery.quickActions',            quickActionsCommand),
        vscode.commands.registerCommand('bindery.formatDocument',          formatDocumentCommand),
        vscode.commands.registerCommand('bindery.formatFolder',            formatFolderCommand),
        vscode.commands.registerCommand('bindery.mergeMarkdown',           () => mergeCommand(['md'])),
        vscode.commands.registerCommand('bindery.mergeDocx',               () => mergeCommand(['docx'])),
        vscode.commands.registerCommand('bindery.mergeEpub',               () => mergeCommand(['epub'])),
        vscode.commands.registerCommand('bindery.mergePdf',                () => mergeCommand(['pdf'])),
        vscode.commands.registerCommand('bindery.mergeAll',                () => mergeCommand(['md', 'docx', 'epub', 'pdf'])),
        vscode.commands.registerCommand('bindery.findProbableUsToUkWords', findProbableUsToUkWordsCommand),
        vscode.commands.registerCommand('bindery.addDialect',              addDialectCommand),
        vscode.commands.registerCommand('bindery.addTranslation',          addTranslationCommand),
        vscode.commands.registerCommand('bindery.addLanguage',             addLanguageCommand),
        vscode.commands.registerCommand('bindery.addUkReplacement',        addDialectCommand), // backward compat alias
        vscode.commands.registerCommand('bindery.openTranslations',        openTranslationsCommand),
        vscode.commands.registerCommand('bindery.startReviewMarker',       startReviewMarkerCommand),
        vscode.commands.registerCommand('bindery.stopReviewMarker',        stopReviewMarkerCommand),
        vscode.commands.registerCommand('bindery.noteList',                () => noteListCommand(context)),
        vscode.commands.registerCommand('bindery.noteGet',                 () => noteGetCommand(context)),
        vscode.commands.registerCommand('bindery.noteCreate',              () => noteCreateCommand(context)),
        vscode.commands.registerCommand('bindery.noteAppend',              () => noteAppendCommand(context)),
        vscode.commands.registerCommand('bindery.characterList',           () => characterListCommand(context)),
        vscode.commands.registerCommand('bindery.characterGet',            () => characterGetCommand(context)),
        vscode.commands.registerCommand('bindery.characterCreate',         () => characterCreateCommand(context)),
        vscode.commands.registerCommand('bindery.characterUpdate',         () => characterUpdateCommand(context)),
        vscode.commands.registerCommand('bindery.arcList',                 () => arcListCommand(context)),
        vscode.commands.registerCommand('bindery.arcGet',                  () => arcGetCommand(context)),
        vscode.commands.registerCommand('bindery.arcCreate',               () => arcCreateCommand(context)),
        vscode.commands.registerCommand('bindery.arcUpdate',               () => arcUpdateCommand(context)),
        vscode.commands.registerCommand('bindery.memoryList',              () => memoryListCommand(context)),
        vscode.commands.registerCommand('bindery.memoryAppend',            () => memoryAppendCommand(context)),
        vscode.commands.registerCommand('bindery.memoryCompact',           () => memoryCompactCommand(context)),
        vscode.commands.registerCommand('bindery.chapterStatusGet',        () => chapterStatusGetCommand(context)),
        vscode.commands.registerCommand('bindery.chapterStatusUpdate',     () => chapterStatusUpdateCommand(context)),
        vscode.commands.registerCommand('bindery.sessionFocusShow',        () => sessionFocusShowCommand(context)),
        vscode.commands.registerCommand('bindery.sessionFocusUpdate',      () => sessionFocusUpdateCommand(context)),
        vscode.commands.registerCommand('bindery.sessionFocusAppendHandoff', () => sessionFocusAppendHandoffCommand(context)),
        vscode.commands.registerCommand('bindery.inboxProcess',            () => inboxProcessCommand(context)),
        vscode.commands.registerCommand('bindery.inboxResolve',            () => inboxResolveCommand(context)),
        vscode.commands.registerCommand('bindery.registerMcp',             () => registerMcpCommand(context)),
    );

    // LM tools (Copilot Chat)
    registerLmTools(context);

    // AI setup version check — prompt if generated files are out of date
    const root = getWorkspaceRoot();
    if (root && fs.existsSync(getSettingsPath(root))) {
        try {
            const tools = loadMcpToolsForAi(context.extensionPath);
            const raw = tools.toolHealth(root);
            const health = JSON.parse(raw) as { ai_version_outdated?: boolean };
            if (health.ai_version_outdated) {
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
        } catch {
            // Non-fatal: keep activation resilient if MCP tools are unavailable.
        }
    }

    // Status bar — shown when a markdown file is active
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text    = '$(book) Bindery';
    statusBar.tooltip = 'Bindery: Quick actions';
    statusBar.command = 'bindery.quickActions';
    subscriptions.push(statusBar);

    const updateStatusBar = () => {
        if (vscode.window.activeTextEditor?.document.languageId === 'markdown') {
            statusBar.show();
        } else {
            statusBar.hide();
        }
    };
    subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar));
    context.subscriptions.push(...subscriptions);
    updateStatusBar();
}

export function deactivate(): void { return; }
