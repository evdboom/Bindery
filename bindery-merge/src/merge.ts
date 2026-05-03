/**
 * Book merging — collects and orders markdown files, generates TOC, calls Pandoc.
 *
 * Extracted from vscode-ext/src/merge.ts (ported from mcp-rust/src/merge.rs)
 * Shared library used by both VS Code extension and Obsidian plugin.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cp from 'node:child_process';
import { updateTypography } from '@bindery/core';
import type { LanguageConfig, UkReplacement } from '@bindery/core';

// ─── Types ──────────────────────────────────────────────────────────────────

export type OutputType = 'md' | 'docx' | 'epub' | 'pdf';

export interface MergeOptions {
    /** Workspace root path */
    root: string;
    /** Story folder name (e.g. "Story") */
    storyFolder: string;
    /** Language configuration */
    language: LanguageConfig;
    /** Output types to generate */
    outputTypes: OutputType[];
    /** Include TOC in markdown output */
    includeToc: boolean;
    /** Include separators between chapters */
    includeSeparators: boolean;
    /** Author name for EPUB/DOCX metadata */
    author?: string;
    /** Book title override */
    bookTitle?: string;
    /** Output directory (relative to root) */
    outputDir: string;
    /** Merged file prefix */
    filePrefix: string;
    /** Path to pandoc executable */
    pandocPath: string;
    /** Path to LibreOffice executable for PDF export */
    libreOfficePath?: string;
    /** Custom US→UK replacements from workspace settings */
    ukReplacements?: UkReplacement[];
    /** Dialect code to apply substitution rules for (e.g. 'en-gb') */
    dialectCode?: string;
}

export interface MergeResult {
    outputs: string[];
    filesMerged: number;
    warnings: string[];
}

// ─── Internal Types ─────────────────────────────────────────────────────────

interface ActInfo {
    name: string;
    number: number;
    subtitle?: string;
}

type FileType =
    | { kind: 'prologue' }
    | { kind: 'act'; act: ActInfo }
    | { kind: 'chapter'; act: ActInfo; num: number }
    | { kind: 'epilogue' };

interface OrderedFile {
    filePath: string;
    fileType: FileType;
}

// ─── Regex Patterns ─────────────────────────────────────────────────────────

const ACT_FOLDER_RE = /^(Act|Deel)\s+(I{1,3}|IV|V)(?:\s*[-–—]\s*(.+))?$/;
const CHAPTER_NUM_RE = /(?:chapter|hoofdstuk)\s*(\d+)/i;
const H1_RE = /^\s*#\s+(.+?)\s*$/m;
const SLUG_CLEAN_RE = /[^\p{L}\p{N}\s-]/gu;
const BLANK_LINES_RE = /\n{2,}/g;
const FIRST_H1_RE = /^(\s*)#\s+/m;
const HEADING_LINE_RE = /^#[^\n]*\n/m;
const FENCE_RE = /^\s*```/;

// ─── UK Conversion (US → UK) ───────────────────────────────────────────────

const UK_REPLACEMENTS: UkReplacement[] = [
    { us: 'color', uk: 'colour' },
    { us: 'colors', uk: 'colours' },
    { us: 'colored', uk: 'coloured' },
    { us: 'coloring', uk: 'colouring' },
    { us: 'center', uk: 'centre' },
    { us: 'centers', uk: 'centres' },
    { us: 'centered', uk: 'centred' },
    { us: 'centering', uk: 'centring' },
    { us: 'theater', uk: 'theatre' },
    { us: 'theaters', uk: 'theatres' },
    { us: 'favorite', uk: 'favourite' },
    { us: 'favorites', uk: 'favourites' },
    { us: 'favor', uk: 'favour' },
    { us: 'favors', uk: 'favours' },
    { us: 'favored', uk: 'favoured' },
    { us: 'favoring', uk: 'favouring' },
    { us: 'traveled', uk: 'travelled' },
    { us: 'traveling', uk: 'travelling' },
    { us: 'traveler', uk: 'traveller' },
    { us: 'travelers', uk: 'travellers' },
    { us: 'canceled', uk: 'cancelled' },
    { us: 'canceling', uk: 'cancelling' },
    { us: 'gray', uk: 'grey' },
    { us: 'fiber', uk: 'fibre' },
    { us: 'defense', uk: 'defence' },
    { us: 'offense', uk: 'offence' },
    { us: 'realize', uk: 'realise' },
    { us: 'realizes', uk: 'realises' },
    { us: 'realized', uk: 'realised' },
    { us: 'realizing', uk: 'realising' },
    { us: 'realization', uk: 'realisation' },
    { us: 'organize', uk: 'organise' },
    { us: 'organizes', uk: 'organises' },
    { us: 'organized', uk: 'organised' },
    { us: 'organizing', uk: 'organising' },
    { us: 'organization', uk: 'organisation' },
    { us: 'analyze', uk: 'analyse' },
    { us: 'analyzes', uk: 'analyses' },
    { us: 'analyzed', uk: 'analysed' },
    { us: 'analyzing', uk: 'analysing' },
    { us: 'recognize', uk: 'recognise' },
    { us: 'recognizes', uk: 'recognises' },
    { us: 'recognized', uk: 'recognised' },
    { us: 'recognizing', uk: 'recognising' },
    { us: 'specialize', uk: 'specialise' },
    { us: 'specializes', uk: 'specialises' },
    { us: 'specialized', uk: 'specialised' },
    { us: 'specializing', uk: 'specialising' },
    { us: 'initialize', uk: 'initialise' },
    { us: 'initializes', uk: 'initialises' },
    { us: 'initialized', uk: 'initialised' },
    { us: 'initializing', uk: 'initialising' },
    { us: 'destabilize', uk: 'destabilise' },
    { us: 'destabilizes', uk: 'destabilises' },
    { us: 'destabilized', uk: 'destabilised' },
    { us: 'destabilizing', uk: 'destabilising' },
    { us: 'equalize', uk: 'equalise' },
    { us: 'equalizes', uk: 'equalises' },
    { us: 'equalized', uk: 'equalised' },
    { us: 'equalizing', uk: 'equalising' },
    { us: 'mesmerize', uk: 'mesmerise' },
    { us: 'mesmerizes', uk: 'mesmerises' },
    { us: 'mesmerized', uk: 'mesmerised' },
    { us: 'mesmerizing', uk: 'mesmerising' },
    { us: 'mom', uk: 'mum' },
];

// ─── Helper Functions ───────────────────────────────────────────────────────

function applyCasing(source: string, target: string): string {
    if (source.toUpperCase() === source) {
        return target.toUpperCase();
    }
    if (source[0] && source[0] === source[0].toUpperCase() && source.slice(1) === source.slice(1).toLowerCase()) {
        return target[0].toUpperCase() + target.slice(1);
    }
    return target;
}

function escapeRegExp(value: string): string {
    return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getBuiltInUkReplacements(): UkReplacement[] {
    return [...UK_REPLACEMENTS];
}

function buildUkReplacementData(customReplacements: UkReplacement[] = []): { map: Map<string, string>; pattern: RegExp } {
    const merged = new Map<string, string>();

    for (const item of UK_REPLACEMENTS) {
        const us = item.us.trim().toLowerCase();
        const uk = item.uk.trim();
        if (us && uk) {
            merged.set(us, uk);
        }
    }

    for (const item of customReplacements) {
        const us = item.us.trim().toLowerCase();
        const uk = item.uk.trim();
        if (us && uk) {
            merged.set(us, uk);
        }
    }

    const usWords = Array.from(merged.keys()).map(escapeRegExp).sort((a, b) => b.length - a.length);
    if (usWords.length === 0) {
        return { map: merged, pattern: /$a/ };
    }

    const pattern = new RegExp(`\\b(${usWords.join('|')})\\b`, 'gi');
    return { map: merged, pattern };
}

function convertUsToUkText(text: string, customReplacements: UkReplacement[] = []): string {
    const replacementData = buildUkReplacementData(customReplacements);

    let inFencedBlock = false;
    const lines = text.split(/(\r?\n)/);
    const out: string[] = [];

    for (let i = 0; i < lines.length; i += 2) {
        const line = lines[i] ?? '';
        const lineBreak = lines[i + 1] ?? '';

        if (FENCE_RE.test(line)) {
            inFencedBlock = !inFencedBlock;
            out.push(line + lineBreak);
            continue;
        }

        if (inFencedBlock) {
            out.push(line + lineBreak);
            continue;
        }

        const converted = line.replaceAll(replacementData.pattern, (match) => {
            const replacement = replacementData.map.get(match.toLowerCase());
            if (!replacement) {
                return match;
            }
            return applyCasing(match, replacement);
        });

        out.push(converted + lineBreak);
    }

    return out.join('');
}

function convertUsToUkDirectory(dirPath: string, customReplacements: UkReplacement[] = []): number {
    let changed = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            changed += convertUsToUkDirectory(fullPath, customReplacements);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const converted = convertUsToUkText(content, customReplacements);
            if (converted !== content) {
                fs.writeFileSync(fullPath, converted, 'utf-8');
                changed++;
            }
        }
    }

    return changed;
}

function isLegacyUkLanguage(lang: LanguageConfig): boolean {
    return lang.code.trim().toUpperCase() === 'UK' || lang.folderName.trim().toUpperCase() === 'UK';
}

function prepareDialectFolder(
    root: string,
    storyFolder: string,
    sourceFolderName: string,
    dialectFolderName: string,
    customReplacements: UkReplacement[] = []
): void {
    const storyRoot   = path.join(root, storyFolder);
    const sourcePath  = path.join(storyRoot, sourceFolderName);
    const dialectPath = path.join(storyRoot, dialectFolderName);

    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source folder not found for dialect generation: ${sourcePath}`);
    }
    if (fs.existsSync(dialectPath)) {
        fs.rmSync(dialectPath, { recursive: true, force: true });
    }
    fs.cpSync(sourcePath, dialectPath, { recursive: true });
    convertUsToUkDirectory(dialectPath, customReplacements);
}

function cleanupDialectTempFolder(root: string, storyFolder: string, folderName: string): void {
    const p = path.join(root, storyFolder, folderName);
    if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
    }
}

function romanToInt(roman: string): number | undefined {
    const map: Record<string, number> = {
        'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5
    };
    return map[roman.toUpperCase()];
}

function intToRoman(n: number): string {
    const map: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };
    return map[n] ?? 'I';
}

function parseActFolder(name: string): ActInfo | undefined {
    const m = ACT_FOLDER_RE.exec(name);
    if (!m) { return undefined; }
    const num = romanToInt(m[2]);
    if (num === undefined) { return undefined; }
    return { name, number: num, subtitle: m[3]?.trim() };
}

function extractChapterNum(filename: string): number | undefined {
    const m = CHAPTER_NUM_RE.exec(filename);
    return m ? Number.parseInt(m[1], 10) : undefined;
}

function generateSlug(text: string): string {
    return text
        .toLowerCase()
        .replaceAll(SLUG_CLEAN_RE, '')
        .trim()
        .split(/\s+/)
        .join('-');
}

function demoteH1ToH2(text: string): string {
    return text.replace(FIRST_H1_RE, '$1## ');
}

function collapseBlankLines(text: string): string {
    return text.replaceAll(BLANK_LINES_RE, '\n\n');
}

function formatActTitle(act: ActInfo, lang: LanguageConfig): string {
    const roman = intToRoman(act.number);
    return act.subtitle
        ? `${lang.actPrefix} ${roman} - ${act.subtitle}`
        : `${lang.actPrefix} ${roman}`;
}

// ─── File Discovery ─────────────────────────────────────────────────────────

function getOrderedFiles(langPath: string, lang: LanguageConfig): OrderedFile[] {
    const files: OrderedFile[] = [];

    // Prologue
    const prologue = path.join(langPath, 'Prologue.md');
    if (fs.existsSync(prologue)) {
        files.push({ filePath: prologue, fileType: { kind: 'prologue' } });
    }
    if (lang.prologueLabel !== 'Prologue') {
        const localPrologue = path.join(langPath, `${lang.prologueLabel}.md`);
        if (fs.existsSync(localPrologue) && !fs.existsSync(prologue)) {
            files.push({ filePath: localPrologue, fileType: { kind: 'prologue' } });
        }
    }

    // Discover Act folders
    const acts: ActInfo[] = [];
    const actFolders = new Map<number, string>();

    for (const entry of fs.readdirSync(langPath, { withFileTypes: true })) {
        if (!entry.isDirectory()) { continue; }
        const info = parseActFolder(entry.name);
        if (info) {
            actFolders.set(info.number, path.join(langPath, entry.name));
            acts.push(info);
        }
    }

    acts.sort((a, b) => a.number - b.number);

    for (const act of acts) {
        files.push({ filePath: actFolders.get(act.number)!, fileType: { kind: 'act', act } });

        const actPath = actFolders.get(act.number)!;
        const chapters: Array<{ num: number; filePath: string }> = [];

        for (const entry of fs.readdirSync(actPath, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) { continue; }
            const num = extractChapterNum(entry.name);
            if (num !== undefined) {
                chapters.push({ num, filePath: path.join(actPath, entry.name) });
            }
        }

        chapters.sort((a, b) => a.num - b.num);

        for (const ch of chapters) {
            files.push({
                filePath: ch.filePath,
                fileType: { kind: 'chapter', act, num: ch.num }
            });
        }
    }

    // Epilogue
    const epilogue = path.join(langPath, 'Epilogue.md');
    if (fs.existsSync(epilogue)) {
        files.push({ filePath: epilogue, fileType: { kind: 'epilogue' } });
    }
    if (lang.epilogueLabel !== 'Epilogue') {
        const localEpilogue = path.join(langPath, `${lang.epilogueLabel}.md`);
        if (fs.existsSync(localEpilogue) && !fs.existsSync(epilogue)) {
            files.push({ filePath: localEpilogue, fileType: { kind: 'epilogue' } });
        }
    }

    return files;
}

// ─── TOC Generation ─────────────────────────────────────────────────────────

function generateToc(files: OrderedFile[], lang: LanguageConfig): string {
    let toc = '# Table of Contents\n\n';

    for (const file of files) {
        let title: string;

        switch (file.fileType.kind) {
            case 'prologue':
                title = lang.prologueLabel;
                toc += `- [${title}](#${generateSlug(title)})\n`;
                break;

            case 'act':
                title = formatActTitle(file.fileType.act, lang);
                toc += `- ${title}\n`;
                break;

            case 'chapter': {
                const content = fs.readFileSync(file.filePath, 'utf-8');
                const h1match = H1_RE.exec(content);
                title = h1match ? h1match[1] : path.basename(file.filePath, '.md');
                toc += `  - [${title}](#${generateSlug(title)})\n`;
                break;
            }

            case 'epilogue':
                title = lang.epilogueLabel;
                toc += `- [${title}](#${generateSlug(title)})\n`;
                break;
        }
    }

    return toc;
}

// ─── Markdown Content Builder ───────────────────────────────────────────────

const PAGE_BREAK = `
\`\`\`{=openxml}
<w:p><w:r><w:br w:type="page"/></w:r></w:p>
\`\`\`
`;

function buildMarkdownContent(files: OrderedFile[], options: MergeOptions): string {
    let content = '';

    if (options.includeToc) {
        const toc = generateToc(files, options.language);
        content += toc + '\n---\n\n';
    }

    let currentAct: number | null = null;

    for (const file of files) {
        switch (file.fileType.kind) {
            case 'prologue':
            case 'epilogue': {
                const fileContent = fs.readFileSync(file.filePath, 'utf-8');
                content += fileContent;
                break;
            }
            case 'act':
                currentAct = file.fileType.act.number;
                content += `# ${formatActTitle(file.fileType.act, options.language)}\n\n`;
                break;
            case 'chapter': {
                const fileContent = fs.readFileSync(file.filePath, 'utf-8');
                if (currentAct !== file.fileType.act.number) {
                    currentAct = file.fileType.act.number;
                    content += `# ${formatActTitle(file.fileType.act, options.language)}\n\n`;
                }
                content += fileContent;
                break;
            }
        }

        if (options.includeSeparators) {
            content += '\n\n---\n\n';
        } else {
            content += '\n\n';
        }
    }

    return collapseBlankLines(content);
}

// ─── Pandoc Content Builder ─────────────────────────────────────────────────

function hasNextContentFile(files: OrderedFile[], currentIndex: number): boolean {
    for (let i = currentIndex + 1; i < files.length; i++) {
        if (files[i].fileType.kind !== 'act') { return true; }
    }
    return false;
}

function imageMarkdownFor(file: OrderedFile, options: MergeOptions): string | undefined {
    let imageName: string;
    switch (file.fileType.kind) {
        case 'prologue': imageName = 'prologue.jpg'; break;
        case 'epilogue': imageName = 'epilogue.jpg'; break;
        case 'chapter': imageName = `chapter${file.fileType.num}.jpg`; break;
        default: return undefined;
    }

    const imagePath = path.join(options.root, 'images', imageName);
    if (!fs.existsSync(imagePath)) { return undefined; }
    return `![](${imagePath.replaceAll(/\\/g, '/')})\n\n`;
}

function insertImageAfterHeading(content: string, imageMd: string): string {
    const m = HEADING_LINE_RE.exec(content);
    if (m) {
        const end = m.index + m[0].length;
        return content.substring(0, end) + imageMd + content.substring(end);
    }
    return imageMd + content;
}

function coverMarkdown(options: MergeOptions): string | undefined {
    const coverPath = path.join(options.root, options.storyFolder, options.language.folderName, 'cover.jpg');
    if (!fs.existsSync(coverPath)) { return undefined; }
    return `![](${coverPath.replaceAll(/\\/g, '/')})\n\n`;
}

function buildPandocContent(files: OrderedFile[], options: MergeOptions, outputType: OutputType): string {
    let content = '';

    const pageBreak = outputType === 'pdf'
        ? '\n```{=latex}\n\\newpage\n```\n'
        : PAGE_BREAK;

    if (outputType === 'docx' || outputType === 'pdf') {
        const cover = coverMarkdown(options);
        if (cover) {
            content += cover + pageBreak + '\n';
        }
    }

    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        switch (file.fileType.kind) {
            case 'prologue':
            case 'epilogue': {
                let fileContent = fs.readFileSync(file.filePath, 'utf-8');
                const img = imageMarkdownFor(file, options);
                if (img) { fileContent = insertImageAfterHeading(fileContent, img); }
                content += fileContent;
                break;
            }
            case 'act':
                content += `# ${formatActTitle(file.fileType.act, options.language)}\n\n`;
                break;
            case 'chapter': {
                let fileContent = fs.readFileSync(file.filePath, 'utf-8');
                fileContent = demoteH1ToH2(fileContent);
                const img = imageMarkdownFor(file, options);
                if (img) { fileContent = insertImageAfterHeading(fileContent, img); }
                content += fileContent;
                break;
            }
        }

        if (i < files.length - 1) {
            content += '\n\n';
            if ((outputType === 'docx' || outputType === 'pdf') && hasNextContentFile(files, i)) {
                content += pageBreak;
            }
        }
    }

    return collapseBlankLines(content);
}

// ─── Pandoc & LibreOffice Invocation ─────────────────────────────────────────

function resolveBookTitle(options: MergeOptions): string {
    const fromOptions = options.bookTitle?.trim();
    if (fromOptions) { return fromOptions; }

    const fromLanguage = options.language.bookTitle?.trim();
    if (fromLanguage) { return fromLanguage; }

    return 'Book';
}

export async function checkPandoc(pandocPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        cp.execFile(pandocPath, ['--version'], { encoding: 'utf-8' }, (err, stdout) => {
            if (err) {
                reject(new Error('Pandoc is not available. Install it from https://pandoc.org'));
            } else {
                resolve(stdout.split('\n')[0] ?? 'unknown');
            }
        });
    });
}

const pandocFormatsCache = new Map<string, string[]>();

export async function getPandocOutputFormats(pandocPath: string): Promise<string[]> {
    const cached = pandocFormatsCache.get(pandocPath);
    if (cached) { return cached; }
    return new Promise((resolve) => {
        cp.execFile(pandocPath, ['--list-output-formats'], { encoding: 'utf-8' }, (err, stdout) => {
            if (err) { resolve([]); return; }
            const formats = stdout.split(/\r?\n/).map(v => v.trim().toLowerCase()).filter(Boolean);
            pandocFormatsCache.set(pandocPath, formats);
            resolve(formats);
        });
    });
}

export function clearPandocCapabilityCache(): void {
    pandocFormatsCache.clear();
}

function runPandoc(
    inputPath: string,
    outputPath: string,
    outputType: OutputType,
    root: string,
    title: string,
    lang: LanguageConfig,
    author: string | undefined,
    pandocPath: string
): Promise<void> {
    const args: string[] = [
        inputPath,
        '-o', outputPath,
        '--metadata', `title=${title}`,
    ];

    if (author) {
        args.push('--metadata', `author=${author}`);
    }

    const langCode = lang.code.toLowerCase();
    args.push('--metadata', `lang=${langCode}`);

    const date = new Date().toISOString().slice(0, 10);
    args.push('--metadata', `date=${date}`);

    if (outputType === 'docx') {
        args.push('--from=markdown+raw_attribute');
        const reference = path.join(root, 'reference.docx');
        if (fs.existsSync(reference)) {
            args.push('--reference-doc', reference);
        }
    }

    if (outputType === 'epub') {
        args.push('--split-level=2');
        const cover = path.join(root, 'Story', lang.folderName, 'cover.jpg');
        if (fs.existsSync(cover)) {
            args.push('--epub-cover-image', cover);
        }
    }

    return new Promise((resolve, reject) => {
        cp.execFile(pandocPath, args, { encoding: 'utf-8' }, (err, _stdout, stderr) => {
            if (err) {
                const details = stderr || err.message;
                reject(new Error(`Pandoc failed: ${details}`));
            } else {
                resolve();
            }
        });
    });
}

async function runLibreOfficeToPdf(
    docxPath: string,
    outputDir: string,
    finalPdfPath: string,
    libreOfficePath: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        cp.execFile(
            libreOfficePath,
            ['--headless', '--convert-to', 'pdf', docxPath, '--outdir', outputDir],
            { encoding: 'utf-8' },
            (err, _stdout, stderr) => {
                if (err) {
                    const details = stderr || err.message;
                    reject(new Error(
                        `LibreOffice PDF conversion failed: ${details}\n` +
                        'Make sure LibreOffice is installed and libreOfficePath is correct.'
                    ));
                    return;
                }
                const tempPdfName = path.basename(docxPath, '.docx') + '.pdf';
                const tempPdfPath = path.join(outputDir, tempPdfName);
                try {
                    fs.renameSync(tempPdfPath, finalPdfPath);
                    resolve();
                } catch (renameErr: any) {
                    reject(new Error(`Failed to rename LibreOffice output: ${renameErr.message}`));
                }
            }
        );
    });
}

function formatDirectory(dirPath: string): number {
    let count = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            count += formatDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const formatted = updateTypography(content);
            if (content !== formatted) {
                fs.writeFileSync(fullPath, formatted, 'utf-8');
                count++;
            }
        }
    }

    return count;
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export async function mergeBook(options: MergeOptions): Promise<MergeResult> {
    const isLegacyUk = isLegacyUkLanguage(options.language);

    if (isLegacyUk) {
        prepareDialectFolder(options.root, options.storyFolder, 'EN', 'UK', options.ukReplacements ?? []);
    } else if (options.dialectCode) {
        prepareDialectFolder(
            options.root, options.storyFolder,
            options.language.folderName,
            `_dialect_${options.dialectCode}`,
            options.ukReplacements ?? []
        );
    }

    const effectiveFolderName = isLegacyUk
        ? 'UK'
        : options.dialectCode
            ? `_dialect_${options.dialectCode}`
            : options.language.folderName;

    try {
        const langPath = path.join(options.root, options.storyFolder, effectiveFolderName);

        if (!fs.existsSync(langPath)) {
            throw new Error(`Language folder not found: ${langPath}`);
        }

        formatDirectory(langPath);

        const files = getOrderedFiles(langPath, options.language);
        if (files.length === 0) {
            throw new Error(`No markdown files found in ${langPath}`);
        }

        const outputDir = path.join(options.root, options.outputDir);
        fs.mkdirSync(outputDir, { recursive: true });

        const folderSuffix = options.dialectCode
            ? options.dialectCode.toUpperCase()
            : options.language.folderName;
        const baseName = `${options.filePrefix}_${folderSuffix}_Merged`;
        const outputs: string[] = [];
        const warnings: string[] = [];

        const needsPandoc = options.outputTypes.some(t => t === 'docx' || t === 'epub' || t === 'pdf');
        if (needsPandoc) {
            await checkPandoc(options.pandocPath);

            const supported = await getPandocOutputFormats(options.pandocPath);
            if (supported.length > 0) {
                for (const t of options.outputTypes) {
                    const pandocFormat = t === 'pdf' ? 'docx' : t;
                    if (pandocFormat === 'md') { continue; }
                    if (!supported.includes(pandocFormat)) {
                        warnings.push(
                            `Pandoc at ${options.pandocPath} does not support '${pandocFormat}' output. ` +
                            `Install a full pandoc build from https://pandoc.org or remove '${t}' from the export list.`
                        );
                    }
                }
            }
        }

        const title = resolveBookTitle(options);

        for (const outputType of options.outputTypes) {
            const outputPath = path.join(outputDir, `${baseName}.${outputType}`);

            if (outputType === 'md') {
                const content = buildMarkdownContent(files, options);
                fs.writeFileSync(outputPath, content, 'utf-8');
                outputs.push(outputPath);
            } else if (outputType === 'pdf') {
                const libreOfficePath = options.libreOfficePath?.trim() || 'libreoffice';
                const tempMdPath = path.join(outputDir, `${baseName}_pdf_temp.md`);
                const tempDocxPath = path.join(outputDir, `${baseName}_pdf_temp.docx`);
                const content = buildPandocContent(files, options, 'docx');
                fs.writeFileSync(tempMdPath, content, 'utf-8');
                try {
                    await runPandoc(tempMdPath, tempDocxPath, 'docx', options.root, title, options.language, options.author, options.pandocPath);
                    await runLibreOfficeToPdf(tempDocxPath, outputDir, outputPath, libreOfficePath);
                    outputs.push(outputPath);
                } finally {
                    try { fs.unlinkSync(tempMdPath); } catch { /* ignore */ }
                    try { fs.unlinkSync(tempDocxPath); } catch { /* ignore */ }
                }
            } else {
                const content = buildPandocContent(files, options, outputType);
                const tempPath = path.join(outputDir, `${baseName}_temp.md`);
                fs.writeFileSync(tempPath, content, 'utf-8');
                try {
                    await runPandoc(tempPath, outputPath, outputType, options.root, title, options.language, options.author, options.pandocPath);
                    outputs.push(outputPath);
                } finally {
                    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
                }
            }
        }

        return { outputs, filesMerged: files.length, warnings };
    } finally {
        if (isLegacyUk) {
            cleanupDialectTempFolder(options.root, options.storyFolder, 'UK');
        } else if (options.dialectCode) {
            cleanupDialectTempFolder(options.root, options.storyFolder, `_dialect_${options.dialectCode}`);
        }
    }
}
