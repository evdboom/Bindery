"use strict";
/**
 * MCP tool implementations for Bindery.
 *
 * Each exported function corresponds to one MCP tool.
 * All functions receive `root: string` (resolved workspace root) plus
 * tool-specific arguments, and return a plain string (tool result content).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolHealth = toolHealth;
exports.toolIndexBuild = toolIndexBuild;
exports.toolIndexStatus = toolIndexStatus;
exports.toolGetText = toolGetText;
exports.toolGetChapter = toolGetChapter;
exports.toolGetOverview = toolGetOverview;
exports.toolGetNotes = toolGetNotes;
exports.toolSearch = toolSearch;
exports.toolRetrieveContext = toolRetrieveContext;
exports.toolFormat = toolFormat;
exports.toolGetReviewText = toolGetReviewText;
exports.toolGitSnapshot = toolGitSnapshot;
exports.toolGetTranslation = toolGetTranslation;
exports.toolAddTranslation = toolAddTranslation;
exports.toolAddDialect = toolAddDialect;
exports.toolGetDialect = toolGetDialect;
exports.toolAddLanguage = toolAddLanguage;
exports.toolInitWorkspace = toolInitWorkspace;
exports.toolSetupAiFiles = toolSetupAiFiles;
exports.toolMemoryList = toolMemoryList;
exports.toolMemoryAppend = toolMemoryAppend;
exports.toolMemoryCompact = toolMemoryCompact;
exports.toolChapterStatusGet = toolChapterStatusGet;
exports.toolChapterStatusUpdate = toolChapterStatusUpdate;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const format_js_1 = require("./format.js");
const search_js_1 = require("./search.js");
const aisetup_js_1 = require("./aisetup.js");
// ─── Shared helpers ───────────────────────────────────────────────────────────
function readJson(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    catch {
        return null;
    }
}
function readSettings(root) {
    return readJson(path.join(root, '.bindery', 'settings.json'));
}
function storyFolder(root) {
    return readSettings(root)?.storyFolder ?? 'Story';
}
// ─── health ───────────────────────────────────────────────────────────────────
function toolHealth(root) {
    const lines = [`root: ${root}`];
    const settingsPath = path.join(root, '.bindery', 'settings.json');
    if (fs.existsSync(settingsPath)) {
        lines.push('settings.json: present');
    }
    else {
        lines.push('settings.json: missing — run init_workspace to set up this book');
    }
    const memDir = path.join(root, '.bindery', 'memories');
    const memFiles = fs.existsSync(memDir)
        ? fs.readdirSync(memDir).filter(f => f.endsWith('.md')).length
        : -1;
    lines.push(`memories: ${memFiles >= 0 ? `present (${memFiles} file${memFiles === 1 ? '' : 's'})` : 'not created yet'}`);
    const idxPath = (0, search_js_1.indexPath)(root);
    if (fs.existsSync(idxPath)) {
        const raw = readJson(idxPath);
        lines.push(`index: present (chunks=${raw?.meta?.chunkCount ?? '?'}, built=${raw?.meta?.builtAt ?? '?'})`);
    }
    else {
        lines.push('index: not built — run index_build first');
    }
    const ollamaUrl = process.env['BINDERY_OLLAMA_URL'];
    lines.push(`embeddings: ${ollamaUrl ? `ollama at ${ollamaUrl}` : 'BM25 only (set BINDERY_OLLAMA_URL for reranking)'}`);
    return lines.join('\n');
}
// ─── index_build ─────────────────────────────────────────────────────────────
function toolIndexBuild(root) {
    const { meta } = (0, search_js_1.buildIndex)(root);
    return `Index built: ${meta.chunkCount} chunks, ${new Date(meta.builtAt).toLocaleString()}`;
}
// ─── index_status ─────────────────────────────────────────────────────────────
function toolIndexStatus(root) {
    const p = (0, search_js_1.indexPath)(root);
    if (!fs.existsSync(p)) {
        return 'No index found. Run index_build first.';
    }
    const raw = readJson(p);
    if (!raw?.meta) {
        return 'Index file exists but metadata is unreadable.';
    }
    return [
        `chunks: ${raw.meta.chunkCount ?? '?'}`,
        `built:  ${raw.meta.builtAt ?? '?'}`,
        `root:   ${raw.meta.root ?? '?'}`,
    ].join('\n');
}
function toolGetText(root, args) {
    // Try as relative path first, then search in story folder
    const candidates = [
        path.join(root, args.identifier),
        path.join(root, storyFolder(root), args.identifier),
    ];
    let filePath = null;
    for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) {
            filePath = c;
            break;
        }
    }
    if (!filePath) {
        return `File not found: ${args.identifier}`;
    }
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
    const start = (args.startLine ?? 1) - 1;
    const end = args.endLine ?? lines.length;
    return lines.slice(start, end).join('\n');
}
function toolGetChapter(root, args) {
    const story = storyFolder(root);
    const langDir = path.join(root, story, args.language.toUpperCase());
    if (!fs.existsSync(langDir)) {
        return `Language folder not found: ${args.language.toUpperCase()}`;
    }
    // Search recursively for a file whose name contains the chapter number
    const file = findChapterFile(langDir, args.chapterNumber);
    if (!file) {
        return `Chapter ${args.chapterNumber} not found in ${args.language.toUpperCase()}`;
    }
    return fs.readFileSync(file, 'utf-8');
}
function findChapterFile(dir, num) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const found = findChapterFile(fullPath, num);
            if (found) {
                return found;
            }
        }
        else if (entry.isFile() && entry.name.endsWith('.md')) {
            const m = /(?:chapter|hoofdstuk|chapter_?)\s*(\d+)/i.exec(entry.name);
            if (m && parseInt(m[1], 10) === num) {
                return fullPath;
            }
        }
    }
    return null;
}
function toolGetOverview(root, args) {
    const story = storyFolder(root);
    const langs = args.language && args.language !== 'ALL'
        ? [args.language.toUpperCase()]
        : detectLangFolders(root, story);
    const lines = [];
    for (const lang of langs) {
        const langDir = path.join(root, story, lang);
        if (!fs.existsSync(langDir)) {
            continue;
        }
        lines.push(`## ${lang}`);
        lines.push(...overviewForLang(langDir, args.act));
        lines.push('');
    }
    return lines.join('\n') || 'No language folders found.';
}
function overviewForLang(langDir, actFilter) {
    const lines = [];
    const entries = fs.readdirSync(langDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));
    for (const actEntry of entries) {
        const actNum = parseActNumber(actEntry.name);
        if (actFilter !== undefined && actNum !== null && actNum !== actFilter) {
            continue;
        }
        lines.push(`### ${actEntry.name}`);
        const actDir = path.join(langDir, actEntry.name);
        const chapters = fs.readdirSync(actDir, { withFileTypes: true })
            .filter(e => e.isFile() && e.name.endsWith('.md'))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        for (const ch of chapters) {
            const fullPath = path.join(actDir, ch.name);
            const firstLine = firstH1(fullPath);
            lines.push(`- ${ch.name}${firstLine ? ': ' + firstLine : ''}`);
        }
    }
    // Top-level .md files (prologue, epilogue)
    const topLevel = fs.readdirSync(langDir, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.md'));
    if (topLevel.length > 0 && actFilter === undefined) {
        lines.push('### Top-level');
        for (const f of topLevel) {
            const firstLine = firstH1(path.join(langDir, f.name));
            lines.push(`- ${f.name}${firstLine ? ': ' + firstLine : ''}`);
        }
    }
    return lines;
}
function firstH1(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const m = /^#\s+(.+)/m.exec(content);
        return m ? m[1].trim() : null;
    }
    catch {
        return null;
    }
}
function parseActNumber(name) {
    const roman = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
    const m = /\b(I{1,3}|IV|V)\b/.exec(name);
    return m ? roman[m[1]] ?? null : null;
}
function detectLangFolders(root, storyFolderName) {
    const storyPath = path.join(root, storyFolderName);
    if (!fs.existsSync(storyPath)) {
        return [];
    }
    return fs.readdirSync(storyPath, { withFileTypes: true })
        .filter(e => e.isDirectory() && /^[A-Z]{2,3}$/i.test(e.name))
        .map(e => e.name.toUpperCase());
}
function toolGetNotes(root, args) {
    const notesDir = path.join(root, 'Notes');
    const candidates = [];
    if (fs.existsSync(notesDir)) {
        collectAllMd(notesDir, candidates);
    }
    // Also Details_*.md files at root
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isFile() && /^Details_.*\.md$/i.test(entry.name)) {
            candidates.push(path.join(root, entry.name));
        }
    }
    if (candidates.length === 0) {
        return 'No notes files found.';
    }
    const catFilter = args.category?.toLowerCase();
    const nameFilter = args.name?.toLowerCase();
    const results = [];
    for (const filePath of candidates) {
        const relName = path.basename(filePath, '.md').toLowerCase();
        if (catFilter && !relName.includes(catFilter)) {
            continue;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        if (nameFilter) {
            // Extract sections containing the name
            const sections = content.split(/^#{1,3}\s+/m);
            for (const section of sections) {
                if (section.toLowerCase().includes(nameFilter)) {
                    results.push(section.trim());
                }
            }
        }
        else {
            results.push(`## ${path.basename(filePath)}\n\n${content}`);
        }
    }
    return results.join('\n\n---\n\n') || 'No matching notes found.';
}
function collectAllMd(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectAllMd(fullPath, out);
        }
        else if (entry.isFile() && entry.name.endsWith('.md')) {
            out.push(fullPath);
        }
    }
}
async function toolSearch(root, args) {
    const topK = args.maxResults ?? 10;
    const language = args.language?.toUpperCase();
    let idxData = (0, search_js_1.loadIndex)(root);
    if (!idxData) {
        idxData = (0, search_js_1.buildIndex)(root);
    }
    let results = (0, search_js_1.search)(idxData.ms, idxData.chunks, args.query, topK * 3, language);
    // Optional Ollama reranking
    if (process.env['BINDERY_OLLAMA_URL']) {
        results = await (0, search_js_1.rerank)(results, args.query);
    }
    results = results.slice(0, topK);
    if (results.length === 0) {
        return 'No results found.';
    }
    return results.map((r, i) => formatResult(r, i + 1)).join('\n\n---\n\n');
}
async function toolRetrieveContext(root, args) {
    const topK = args.topK ?? parseInt(process.env['BINDERY_DEFAULT_TOPK'] ?? '6', 10);
    const language = args.language?.toUpperCase();
    let idxData = (0, search_js_1.loadIndex)(root);
    if (!idxData) {
        idxData = (0, search_js_1.buildIndex)(root);
    }
    let results = (0, search_js_1.search)(idxData.ms, idxData.chunks, args.query, topK * 4, language);
    if (process.env['BINDERY_OLLAMA_URL']) {
        results = await (0, search_js_1.rerank)(results, args.query);
    }
    results = results.slice(0, topK);
    if (results.length === 0) {
        return 'No context found.';
    }
    const maxBytes = parseInt(process.env['BINDERY_MAX_RESPONSE_BYTES'] ?? '60000', 10);
    const parts = [];
    let total = 0;
    for (let i = 0; i < results.length; i++) {
        const fragment = formatResult(results[i], i + 1);
        if (total + fragment.length > maxBytes) {
            break;
        }
        parts.push(fragment);
        total += fragment.length;
    }
    return parts.join('\n\n---\n\n');
}
function toolFormat(root, args) {
    const target = args.filePath
        ? path.isAbsolute(args.filePath) ? args.filePath : path.join(root, args.filePath)
        : root;
    const changed = [];
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
        if (processFormatFile(target, args.dryRun ?? false)) {
            changed.push(target);
        }
    }
    else if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        formatDir(target, args.dryRun ?? false, !(args.noRecurse ?? false), changed);
    }
    else {
        return `Path not found: ${target}`;
    }
    if (args.dryRun) {
        return changed.length > 0
            ? `Would format ${changed.length} file(s):\n${changed.map(f => path.relative(root, f)).join('\n')}`
            : 'No files need formatting.';
    }
    return changed.length > 0
        ? `Formatted ${changed.length} file(s).`
        : 'No files needed formatting.';
}
function formatDir(dir, dry, recurse, changed) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && recurse) {
            formatDir(fullPath, dry, recurse, changed);
        }
        else if (entry.isFile() && entry.name.endsWith('.md')) {
            if (processFormatFile(fullPath, dry)) {
                changed.push(fullPath);
            }
        }
    }
}
function processFormatFile(filePath, dry) {
    const original = fs.readFileSync(filePath, 'utf-8');
    const formatted = (0, format_js_1.updateTypography)(original);
    if (original === formatted) {
        return false;
    }
    if (!dry) {
        fs.writeFileSync(filePath, formatted, 'utf-8');
    }
    return true;
}
function toolGetReviewText(root, args) {
    const contextLines = args.contextLines ?? 3;
    const language = (args.language ?? 'ALL').toUpperCase();
    let raw;
    try {
        raw = (0, child_process_1.execSync)(`git diff --ignore-cr-at-eol -U${contextLines}`, { cwd: root, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    }
    catch {
        return 'Failed to run git diff. Is this a git repository?';
    }
    if (!raw.trim()) {
        return 'No uncommitted changes.';
    }
    const files = parseUnifiedDiff(raw);
    const filtered = language === 'ALL'
        ? files
        : files.filter(f => {
            const upper = f.file.toUpperCase().replace(/\\/g, '/');
            return upper.includes(`/${language}/`);
        });
    if (filtered.length === 0) {
        return language === 'ALL'
            ? 'No uncommitted changes.'
            : `No uncommitted changes in ${language} files.`;
    }
    const result = formatReviewFiles(filtered);
    // Stage reviewed files so the next review only shows new changes
    if (args.autoStage) {
        const contentDirs = contentFolders(root);
        try {
            (0, child_process_1.execSync)(`git add ${contentDirs.map(d => `"${d}"`).join(' ')}`, { cwd: root, encoding: 'utf-8' });
        }
        catch { /* best effort — staging failure shouldn't break the review */ }
    }
    return result;
}
/** Content folders that git operations should scope to. */
function contentFolders(root) {
    const story = storyFolder(root);
    return [story, 'Notes', 'Arc'].filter(d => fs.existsSync(path.join(root, d)));
}
function toolGitSnapshot(root, args) {
    const dirs = contentFolders(root);
    if (dirs.length === 0) {
        return 'No content folders found to snapshot.';
    }
    // Stage content folders
    try {
        (0, child_process_1.execSync)(`git add ${dirs.map(d => `"${d}"`).join(' ')}`, { cwd: root, encoding: 'utf-8' });
    }
    catch {
        return 'Failed to stage files. Is this a git repository?';
    }
    // Check if there is anything staged
    let staged;
    try {
        staged = (0, child_process_1.execSync)('git diff --cached --name-only', { cwd: root, encoding: 'utf-8' });
    }
    catch {
        return 'Failed to check staged files.';
    }
    if (!staged.trim()) {
        return 'Nothing to snapshot — no changes in content folders.';
    }
    const fileCount = staged.trim().split('\n').length;
    const msg = args.message ?? `Snapshot ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    try {
        (0, child_process_1.execSync)(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: root, encoding: 'utf-8' });
    }
    catch (e) {
        return `Failed to commit: ${e instanceof Error ? e.message : String(e)}`;
    }
    return `Snapshot saved: "${msg}" (${fileCount} file${fileCount === 1 ? '' : 's'})`;
}
function toolGetTranslation(root, args) {
    const filePath = path.join(root, '.bindery', 'translations.json');
    if (!fs.existsSync(filePath)) {
        return 'No translations.json found. Run "init_workspace" or "add_translation" first.';
    }
    let translations;
    try {
        translations = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    catch {
        return 'Error: failed to parse .bindery/translations.json';
    }
    const entryType = args.type ?? 'glossary';
    const langLower = args.language.toLowerCase();
    // Resolve key — case-insensitive, accept code or label
    const matchedKey = Object.keys(translations).find(k => k.toLowerCase() === langLower ||
        translations[k].label?.toLowerCase() === langLower ||
        translations[k].sourceLanguage?.toLowerCase() === langLower);
    if (!matchedKey) {
        const available = Object.entries(translations)
            .filter(([, e]) => e.type === entryType || args.type === undefined)
            .map(([k, e]) => `${k}${e.label ? ` (${e.label})` : ''}`)
            .join(', ');
        return `No translation entry found for "${args.language}". Available: ${available || 'none'}`;
    }
    const entry = translations[matchedKey];
    if (entry.type !== entryType) {
        return `Entry "${matchedKey}" is type "${entry.type}", not "${entryType}". Use get_dialect for substitution rules.`;
    }
    const rules = entry.rules ?? [];
    if (!args.word) {
        if (rules.length === 0) {
            return `No rules defined for "${matchedKey}" yet.`;
        }
        const header = `${matchedKey}${entry.label ? ` — ${entry.label}` : ''} (${entry.type}, ${rules.length} rules):`;
        return [header, ...rules.map(r => `  ${r.from}  →  ${r.to}`)].join('\n');
    }
    const stems = wordStems(args.word.toLowerCase());
    const matches = rules.filter(r => stems.some(s => r.from.toLowerCase() === s));
    if (matches.length === 0) {
        return `"${args.word}" not found in ${matchedKey} translations.`;
    }
    return matches.map(r => `${r.from}  →  ${r.to}  [${matchedKey}]`).join('\n');
}
/** Generate stem variants for forgiving word lookup. */
function wordStems(word) {
    const variants = new Set([word]);
    // strip common suffixes to reach a base form
    if (word.endsWith('ies')) {
        variants.add(word.slice(0, -3) + 'y');
    }
    if (word.endsWith('es')) {
        variants.add(word.slice(0, -2));
    }
    if (word.endsWith('s')) {
        variants.add(word.slice(0, -1));
    }
    if (word.endsWith('ed')) {
        variants.add(word.slice(0, -2));
        variants.add(word.slice(0, -1));
    }
    if (word.endsWith('ing')) {
        variants.add(word.slice(0, -3));
        variants.add(word.slice(0, -3) + 'e');
    }
    // also try adding -s so a bare stem matches plurals stored in the file
    variants.add(word + 's');
    return Array.from(variants);
}
// ─── Built-in en-gb substitution rules (US → British English) ────────────────
const BUILTIN_EN_GB_RULES = [
    { from: 'analyze', to: 'analyse' },
    { from: 'analyzes', to: 'analyses' },
    { from: 'analyzed', to: 'analysed' },
    { from: 'analyzing', to: 'analysing' },
    { from: 'canceled', to: 'cancelled' },
    { from: 'canceling', to: 'cancelling' },
    { from: 'center', to: 'centre' },
    { from: 'centers', to: 'centres' },
    { from: 'centered', to: 'centred' },
    { from: 'centering', to: 'centring' },
    { from: 'color', to: 'colour' },
    { from: 'colors', to: 'colours' },
    { from: 'colored', to: 'coloured' },
    { from: 'coloring', to: 'colouring' },
    { from: 'defense', to: 'defence' },
    { from: 'destabilize', to: 'destabilise' },
    { from: 'destabilizes', to: 'destabilises' },
    { from: 'destabilized', to: 'destabilised' },
    { from: 'destabilizing', to: 'destabilising' },
    { from: 'equalize', to: 'equalise' },
    { from: 'equalizes', to: 'equalises' },
    { from: 'equalized', to: 'equalised' },
    { from: 'equalizing', to: 'equalising' },
    { from: 'favor', to: 'favour' },
    { from: 'favors', to: 'favours' },
    { from: 'favored', to: 'favoured' },
    { from: 'favoring', to: 'favouring' },
    { from: 'favorite', to: 'favourite' },
    { from: 'favorites', to: 'favourites' },
    { from: 'fiber', to: 'fibre' },
    { from: 'gray', to: 'grey' },
    { from: 'initialize', to: 'initialise' },
    { from: 'initializes', to: 'initialises' },
    { from: 'initialized', to: 'initialised' },
    { from: 'initializing', to: 'initialising' },
    { from: 'mesmerize', to: 'mesmerise' },
    { from: 'mesmerizes', to: 'mesmerises' },
    { from: 'mesmerized', to: 'mesmerised' },
    { from: 'mesmerizing', to: 'mesmerising' },
    { from: 'mom', to: 'mum' },
    { from: 'offense', to: 'offence' },
    { from: 'organize', to: 'organise' },
    { from: 'organizes', to: 'organises' },
    { from: 'organized', to: 'organised' },
    { from: 'organizing', to: 'organising' },
    { from: 'organization', to: 'organisation' },
    { from: 'realize', to: 'realise' },
    { from: 'realizes', to: 'realises' },
    { from: 'realized', to: 'realised' },
    { from: 'realizing', to: 'realising' },
    { from: 'realization', to: 'realisation' },
    { from: 'recognize', to: 'recognise' },
    { from: 'recognizes', to: 'recognises' },
    { from: 'recognized', to: 'recognised' },
    { from: 'recognizing', to: 'recognising' },
    { from: 'specialize', to: 'specialise' },
    { from: 'specializes', to: 'specialises' },
    { from: 'specialized', to: 'specialised' },
    { from: 'specializing', to: 'specialising' },
    { from: 'theater', to: 'theatre' },
    { from: 'theaters', to: 'theatres' },
    { from: 'traveler', to: 'traveller' },
    { from: 'travelers', to: 'travellers' },
    { from: 'traveled', to: 'travelled' },
    { from: 'traveling', to: 'travelling' },
];
function toolAddTranslation(root, args) {
    const { targetLangCode, from, to } = args;
    if (!from.trim() || !to.trim()) {
        return 'Error: both "from" and "to" must be non-empty.';
    }
    const filePath = path.join(root, '.bindery', 'translations.json');
    let translations = {};
    if (fs.existsSync(filePath)) {
        try {
            translations = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        catch {
            return 'Error: failed to parse .bindery/translations.json';
        }
    }
    // Default source: EN (from settings) or 'en'
    let sourceLanguage = 'en';
    const settings = readSettings(root);
    const defaultLang = (settings?.languages ?? []).find(l => l.isDefault) ?? settings?.languages?.[0];
    if (defaultLang) {
        sourceLanguage = defaultLang.code.toLowerCase();
    }
    const key = targetLangCode.toLowerCase();
    if (!translations[key]) {
        translations[key] = { type: 'glossary', sourceLanguage, rules: [], ignoredWords: [] };
    }
    const entry = translations[key];
    const rules = entry.rules ?? [];
    const idx = rules.findIndex(r => r.from.toLowerCase() === from.toLowerCase());
    const isUpdate = idx >= 0;
    if (isUpdate) {
        rules[idx] = { from, to };
    }
    else {
        rules.push({ from, to });
        rules.sort((a, b) => a.from.localeCompare(b.from));
    }
    entry.rules = rules;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(translations, null, 2) + '\n', 'utf-8');
    return `${isUpdate ? 'Updated' : 'Added'} glossary: ${from} → ${to} (${key})`;
}
function toolAddDialect(root, args) {
    const { dialectCode, from, to } = args;
    if (!from.trim() || !to.trim()) {
        return 'Error: both "from" and "to" must be non-empty.';
    }
    const filePath = path.join(root, '.bindery', 'translations.json');
    let translations = {};
    if (fs.existsSync(filePath)) {
        try {
            translations = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        catch {
            return 'Error: failed to parse .bindery/translations.json';
        }
    }
    const key = dialectCode.toLowerCase();
    if (!translations[key]) {
        translations[key] = { type: 'substitution', sourceLanguage: 'en', rules: [], ignoredWords: [] };
    }
    const entry = translations[key];
    if (entry.type !== 'substitution') {
        return `Error: entry '${key}' has type '${entry.type}', expected 'substitution'. Use add_translation for glossary entries.`;
    }
    const rules = entry.rules ?? [];
    const fromLower = from.toLowerCase();
    const idx = rules.findIndex(r => r.from.toLowerCase() === fromLower);
    const isUpdate = idx >= 0;
    if (isUpdate) {
        rules[idx] = { from: fromLower, to };
    }
    else {
        rules.push({ from: fromLower, to });
        rules.sort((a, b) => a.from.localeCompare(b.from));
    }
    entry.rules = rules;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(translations, null, 2) + '\n', 'utf-8');
    return `${isUpdate ? 'Updated' : 'Added'} dialect rule: ${fromLower} → ${to} (${key})`;
}
function toolGetDialect(root, args) {
    const filePath = path.join(root, '.bindery', 'translations.json');
    if (!fs.existsSync(filePath)) {
        return 'No translations.json found. Run "init_workspace" or "add_dialect" first.';
    }
    let translations;
    try {
        translations = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    catch {
        return 'Error: failed to parse .bindery/translations.json';
    }
    const key = Object.keys(translations).find(k => k.toLowerCase() === args.dialectCode.toLowerCase());
    if (!key) {
        const available = Object.entries(translations)
            .filter(([, e]) => e.type === 'substitution')
            .map(([k]) => k).join(', ');
        return `No dialect entry "${args.dialectCode}". Available: ${available || 'none'}`;
    }
    const entry = translations[key];
    if (entry.type !== 'substitution') {
        return `Entry "${key}" is type "${entry.type}", not "substitution". Use get_translation for glossary entries.`;
    }
    const rules = entry.rules ?? [];
    if (!args.word) {
        if (rules.length === 0) {
            return `No dialect rules defined for "${key}" yet.`;
        }
        const header = `${key}${entry.label ? ` — ${entry.label}` : ''} (${rules.length} substitution rules):`;
        return [header, ...rules.map(r => `  ${r.from}  →  ${r.to}`)].join('\n');
    }
    const stems = wordStems(args.word.toLowerCase());
    const matches = rules.filter(r => stems.some(s => r.from.toLowerCase() === s));
    if (matches.length === 0) {
        return `"${args.word}" not found in dialect "${key}".`;
    }
    return matches.map(r => `${r.from}  →  ${r.to}  [${key}]`).join('\n');
}
function toolAddLanguage(root, args) {
    const settingsPath = path.join(root, '.bindery', 'settings.json');
    let existing = {};
    try {
        existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
    catch {
        return 'Error: .bindery/settings.json not found. Run init_workspace first.';
    }
    const upper = args.code.trim().toUpperCase();
    const newLang = {
        code: upper,
        folderName: args.folderName?.trim() ?? upper,
        chapterWord: args.chapterWord?.trim() ?? 'Chapter',
        actPrefix: args.actPrefix?.trim() ?? 'Act',
        prologueLabel: args.prologueLabel?.trim() ?? 'Prologue',
        epilogueLabel: args.epilogueLabel?.trim() ?? 'Epilogue',
    };
    const languages = (existing['languages'] ?? []);
    const dupIdx = languages.findIndex(l => l.code.toUpperCase() === upper);
    if (dupIdx >= 0) {
        languages[dupIdx] = newLang;
    }
    else {
        languages.push(newLang);
    }
    existing['languages'] = languages;
    fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
    // Create stub files mirroring source language (default: true)
    const createStubs = args.createStubs !== false;
    const storyFolderName = existing['storyFolder'] ?? 'Story';
    const sourceLang = languages.find((l) => l.isDefault) ?? languages[0];
    let stubCount = 0;
    if (createStubs && sourceLang && sourceLang.code !== upper) {
        const sourceDir = path.join(root, storyFolderName, sourceLang.folderName);
        const targetDir = path.join(root, storyFolderName, newLang.folderName);
        fs.mkdirSync(targetDir, { recursive: true });
        if (fs.existsSync(sourceDir)) {
            const createStubsIn = (srcDir, dstDir) => {
                fs.mkdirSync(dstDir, { recursive: true });
                for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
                    const srcPath = path.join(srcDir, entry.name);
                    const dstPath = path.join(dstDir, entry.name);
                    if (entry.isDirectory()) {
                        createStubsIn(srcPath, dstPath);
                    }
                    else if (entry.isFile() && entry.name.endsWith('.md')) {
                        if (!fs.existsSync(dstPath)) {
                            const src = fs.readFileSync(srcPath, 'utf-8');
                            const h1 = /^#\s+(.+)/m.exec(src);
                            const title = h1 ? h1[1].trim() : path.basename(entry.name, '.md');
                            fs.writeFileSync(dstPath, `# [Untranslated] ${title}\n`, 'utf-8');
                            stubCount++;
                        }
                    }
                }
            };
            createStubsIn(sourceDir, targetDir);
        }
    }
    return `Added language ${upper} to settings.json. Story/${newLang.folderName}/ created with ${stubCount} stub file(s).`;
}
// ─── diff helpers ─────────────────────────────────────────────────────────────
function parseUnifiedDiff(raw) {
    const files = [];
    const fileChunks = raw.split(/^diff --git /m).filter(Boolean);
    for (const chunk of fileChunks) {
        const nameMatch = /^a\/(.+?)\s+b\/(.+)/m.exec(chunk);
        if (!nameMatch) {
            continue;
        }
        const fileName = nameMatch[2];
        const hunks = [];
        const hunkParts = chunk.split(/^@@\s+/m).slice(1);
        for (const hunkPart of hunkParts) {
            const headerMatch = /^-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)/.exec(hunkPart);
            if (!headerMatch) {
                continue;
            }
            const beforeStart = parseInt(headerMatch[1], 10);
            const beforeCount = headerMatch[2] !== undefined ? parseInt(headerMatch[2], 10) : 1;
            const afterStart = parseInt(headerMatch[3], 10);
            const afterCount = headerMatch[4] !== undefined ? parseInt(headerMatch[4], 10) : 1;
            const body = headerMatch[5] + '\n' + hunkPart.slice(headerMatch[0].length);
            const bodyLines = body.split('\n');
            const lines = [];
            let oldLine = beforeStart;
            let newLine = afterStart;
            for (const line of bodyLines) {
                if (line.startsWith('+')) {
                    lines.push({ type: 'insert', text: line.slice(1), newLine: newLine });
                    newLine++;
                }
                else if (line.startsWith('-')) {
                    lines.push({ type: 'delete', text: line.slice(1), oldLine: oldLine });
                    oldLine++;
                }
                else if (line.startsWith(' ') || line === '') {
                    // context line — but skip trailing empty from split
                    if (line.startsWith(' ')) {
                        lines.push({ type: 'context', text: line.slice(1), oldLine: oldLine, newLine: newLine });
                        oldLine++;
                        newLine++;
                    }
                }
            }
            hunks.push({ beforeStart, beforeCount, afterStart, afterCount, lines });
        }
        files.push({ file: fileName, hunks });
    }
    return files;
}
function formatReviewFiles(files) {
    const parts = [];
    for (const file of files) {
        const lines = [`## ${file.file}`];
        for (const hunk of file.hunks) {
            lines.push(`\n@@ -${hunk.beforeStart},${hunk.beforeCount} +${hunk.afterStart},${hunk.afterCount} @@`);
            for (const l of hunk.lines) {
                const prefix = l.type === 'insert' ? '+' : l.type === 'delete' ? '-' : ' ';
                lines.push(`${prefix} ${l.text}`);
            }
        }
        parts.push(lines.join('\n'));
    }
    return parts.join('\n\n---\n\n');
}
function toolInitWorkspace(root, args) {
    const settingsPath = path.join(root, '.bindery', 'settings.json');
    const translationsPath = path.join(root, '.bindery', 'translations.json');
    // Load existing settings to preserve any keys not being updated
    let existing = {};
    const isNew = !fs.existsSync(settingsPath);
    if (!isNew) {
        try {
            existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        }
        catch { /* corrupt — treat as new */ }
    }
    const storyFolderName = args.storyFolder ?? existing['storyFolder'] ?? 'Story';
    const bookTitle = args.bookTitle ?? existing['bookTitle'] ?? path.basename(root);
    // Detect language folders from the story directory
    const storyPath = path.join(root, storyFolderName);
    const detectedLangs = [];
    if (fs.existsSync(storyPath)) {
        for (const entry of fs.readdirSync(storyPath, { withFileTypes: true })) {
            if (entry.isDirectory() && /^[A-Z]{2,3}$/i.test(entry.name)) {
                const code = entry.name.toUpperCase();
                detectedLangs.push({ code, folderName: entry.name, chapterWord: 'Chapter', actPrefix: 'Act', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue' });
            }
        }
    }
    // Merge detected langs with existing to preserve custom properties (dialects, isDefault, labels)
    const existingLangs = (existing['languages'] ?? []);
    const baseLangs = detectedLangs.length > 0
        ? detectedLangs
        : [{ code: 'EN', folderName: 'EN', chapterWord: 'Chapter', actPrefix: 'Act', prologueLabel: 'Prologue', epilogueLabel: 'Epilogue' }];
    const languages = baseLangs.map(dl => {
        const el = existingLangs.find(l => l['code']?.toUpperCase() === dl.code);
        return el ? { ...el, code: dl.code, folderName: dl.folderName } : dl;
    });
    const slug = bookTitle.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/, '') || 'Book';
    const settings = {
        ...existing,
        bookTitle,
        ...(args.author ? { author: args.author } : {}),
        ...(args.genre ? { genre: args.genre } : {}),
        ...(args.description ? { description: args.description } : {}),
        ...(args.targetAudience ? { targetAudience: args.targetAudience } : {}),
        storyFolder: storyFolderName,
        mergedOutputDir: existing['mergedOutputDir'] ?? 'Merged',
        mergeFilePrefix: existing['mergeFilePrefix'] ?? slug,
        formatOnSave: existing['formatOnSave'] ?? false,
        languages,
    };
    fs.mkdirSync(path.join(root, '.bindery'), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    const created = ['.bindery/settings.json'];
    // Create translations.json only if it does not already exist
    if (!fs.existsSync(translationsPath)) {
        const translations = {
            'en-gb': { label: 'British English', type: 'substitution', sourceLanguage: 'en', rules: [], ignoredWords: [] },
        };
        fs.writeFileSync(translationsPath, JSON.stringify(translations, null, 2) + '\n', 'utf-8');
        created.push('.bindery/translations.json');
    }
    const engbDeclared = languages.some((l) => l.dialects?.some(d => d.code?.toLowerCase() === 'en-gb'));
    let engbSeeded = false;
    if (engbDeclared) {
        let trans = {};
        if (fs.existsSync(translationsPath)) {
            try {
                trans = JSON.parse(fs.readFileSync(translationsPath, 'utf-8'));
            }
            catch { /* ignore */ }
        }
        if (!trans['en-gb']?.rules?.length) {
            trans['en-gb'] = { label: 'British English', type: 'substitution', sourceLanguage: 'en', rules: BUILTIN_EN_GB_RULES, ignoredWords: [] };
            fs.writeFileSync(translationsPath, JSON.stringify(trans, null, 2) + '\n', 'utf-8');
            engbSeeded = true;
        }
    }
    const action = isNew ? 'Initialised' : 'Updated';
    const langNote = languages.map(l => l.code).join(', ');
    const hint = isNew
        ? '\n\nTip: AI instruction files (CLAUDE.md, skills, copilot-instructions.md) are not yet set up. Run setup_ai_files to generate them, or use "Bindery: Set Up AI Files" in VS Code.'
        : '';
    const engbNote = engbSeeded ? ' en-gb dialect seeded (75 rules).' : '';
    return `${action}: ${created.join(', ')}. Book: "${bookTitle}", story folder: ${storyFolderName}/, languages: ${langNote}.${engbNote}${hint}`;
}
function toolSetupAiFiles(root, args) {
    const validTargets = ['claude', 'copilot', 'cursor', 'agents'];
    const validSkills = new Set(aisetup_js_1.ALL_SKILLS);
    const targets = (args.targets ?? validTargets)
        .filter((t) => validTargets.includes(t));
    const skills = args.skills
        ? args.skills.filter((s) => validSkills.has(s))
        : aisetup_js_1.ALL_SKILLS;
    if (targets.length === 0) {
        return `No valid targets specified. Valid targets: ${validTargets.join(', ')}`;
    }
    let result;
    try {
        result = (0, aisetup_js_1.setupAiFiles)({ root, targets, skills, overwrite: args.overwrite ?? false });
    }
    catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
    const lines = [];
    if (result.created.length > 0) {
        lines.push(`Created (${result.created.length}):\n${result.created.map(f => `  ${f}`).join('\n')}`);
    }
    if (result.skipped.length > 0) {
        lines.push(`Skipped — already exist (pass overwrite: true to replace) (${result.skipped.length}):\n${result.skipped.map(f => `  ${f}`).join('\n')}`);
    }
    if (lines.length === 0) {
        return 'Nothing to do.';
    }
    return lines.join('\n\n');
}
// ─── memory_list ─────────────────────────────────────────────────────────────
function toolMemoryList(root) {
    const memDir = path.join(root, '.bindery', 'memories');
    if (!fs.existsSync(memDir)) {
        return 'No memory files found yet.';
    }
    const files = fs.readdirSync(memDir, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.md'))
        .sort((a, b) => a.name.localeCompare(b.name));
    if (files.length === 0) {
        return 'No memory files found yet.';
    }
    return files.map(e => {
        const lineCount = fs.readFileSync(path.join(memDir, e.name), 'utf-8').split(/\r?\n/).length;
        return `${e.name}  (${lineCount} lines)`;
    }).join('\n');
}
function toolMemoryAppend(root, args) {
    const memDir = path.join(root, '.bindery', 'memories');
    fs.mkdirSync(memDir, { recursive: true });
    const filePath = path.join(memDir, args.file);
    const date = new Date().toISOString().slice(0, 10);
    const header = `## Session ${date} — ${args.title}`;
    const addition = `\n${header}\n${args.content}`;
    fs.appendFileSync(filePath, addition, 'utf-8');
    const newTotal = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).length;
    const addedLines = addition.split(/\r?\n/).length;
    return `Appended to ${args.file}: ${addedLines} lines added, ${newTotal} total lines.`;
}
function toolMemoryCompact(root, args) {
    const memDir = path.join(root, '.bindery', 'memories');
    const filePath = path.join(memDir, args.file);
    const oldLineCount = fs.existsSync(filePath)
        ? fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).length
        : 0;
    const archiveDir = path.join(memDir, 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const basename = path.basename(args.file, '.md');
    const backupName = `${basename}_${date}.md`;
    const backupPath = path.join(archiveDir, backupName);
    if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, backupPath);
    }
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(filePath, args.compacted_content, 'utf-8');
    const newLineCount = args.compacted_content.split(/\r?\n/).length;
    const relBackup = path.join('.bindery', 'memories', 'archive', backupName);
    return `Compacted ${args.file}: backup → ${relBackup}, old lines: ${oldLineCount}, new lines: ${newLineCount}.`;
}
const STATUS_ORDER = ['done', 'in-progress', 'needs-review', 'draft', 'planned'];
const STATUS_LABELS = {
    'done': 'Done',
    'in-progress': 'In Progress',
    'needs-review': 'Needs Review',
    'draft': 'Draft',
    'planned': 'Planned',
};
function toolChapterStatusGet(root) {
    const filePath = path.join(root, '.bindery', 'chapter-status.json');
    if (!fs.existsSync(filePath)) {
        return 'No chapter status on record. Use chapter_status_update to record progress.';
    }
    let data;
    try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    catch {
        return 'Error: .bindery/chapter-status.json is present but cannot be parsed.';
    }
    const chapters = (data.chapters ?? []).slice().sort((a, b) => a.number - b.number);
    if (chapters.length === 0) {
        return 'No chapters recorded. Use chapter_status_update to record progress.';
    }
    const byStatus = new Map();
    for (const ch of chapters) {
        const list = byStatus.get(ch.status) ?? [];
        list.push(ch);
        byStatus.set(ch.status, list);
    }
    const lines = [`Chapter status — updated ${data.updatedAt}, ${chapters.length} chapter(s)`];
    for (const status of STATUS_ORDER) {
        const group = byStatus.get(status);
        if (!group || group.length === 0) {
            continue;
        }
        lines.push(`\n${STATUS_LABELS[status]} (${group.length})`);
        for (const ch of group) {
            const meta = [];
            if (ch.language !== 'EN') {
                meta.push(ch.language);
            }
            if (ch.wordCount) {
                meta.push(`~${ch.wordCount}w`);
            }
            const suffix = meta.length ? ` [${meta.join(', ')}]` : '';
            lines.push(`  Ch ${ch.number} — ${ch.title}${suffix}`);
            if (ch.notes) {
                lines.push(`    ${ch.notes}`);
            }
        }
    }
    return lines.join('\n');
}
function toolChapterStatusUpdate(root, args) {
    if (!args.chapters || args.chapters.length === 0) {
        return 'Error: chapters array must not be empty.';
    }
    const filePath = path.join(root, '.bindery', 'chapter-status.json');
    let data = { schemaVersion: 1, updatedAt: '', chapters: [] };
    if (fs.existsSync(filePath)) {
        try {
            data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        catch { /* corrupt — start fresh */ }
    }
    const chapters = data.chapters ?? [];
    let added = 0, updated = 0;
    for (const incoming of args.chapters) {
        const lang = (incoming.language ?? 'EN').toUpperCase();
        const entry = { ...incoming, language: lang };
        const idx = chapters.findIndex(c => c.number === entry.number && c.language === lang);
        if (idx >= 0) {
            chapters[idx] = entry;
            updated++;
        }
        else {
            chapters.push(entry);
            added++;
        }
    }
    chapters.sort((a, b) => a.language.localeCompare(b.language) || a.number - b.number);
    const out = {
        schemaVersion: 1,
        updatedAt: new Date().toISOString().slice(0, 10),
        chapters,
    };
    fs.mkdirSync(path.join(root, '.bindery'), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(out, null, 2) + '\n', 'utf-8');
    return `Chapter status updated: ${added} added, ${updated} updated. Total: ${chapters.length} chapters.`;
}
// ─── Shared formatter ─────────────────────────────────────────────────────────
function formatResult(r, idx) {
    const snippetMax = parseInt(process.env['BINDERY_SNIPPET_MAX_CHARS'] ?? '1600', 10);
    const text = r.chunk.text.length > snippetMax
        ? r.chunk.text.slice(0, snippetMax) + '…'
        : r.chunk.text;
    return [
        `[${idx}] ${r.chunk.relPath} (lines ${r.chunk.startLine}–${r.chunk.endLine}, score=${r.score.toFixed(3)}, source=${r.source})`,
        text,
    ].join('\n');
}
//# sourceMappingURL=tools.js.map