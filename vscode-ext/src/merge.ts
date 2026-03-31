/**
 * Book merging — collects and orders markdown files, generates TOC, calls Pandoc.
 *
 * Ported from mcp-rust/src/merge.rs
 */

import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { updateTypography } from './format';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LanguageConfig {
    code: string;
    folderName: string;
    chapterWord: string;
    actPrefix: string;
    prologueLabel: string;
    epilogueLabel: string;
}

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
    /** Path to LibreOffice executable for PDF export (e.g. 'libreoffice' on Linux, full soffice.exe path on Windows) */
    libreOfficePath?: string;
    /** Custom US→UK replacements from workspace settings */
    ukReplacements?: UkReplacement[];
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

/** Matches Act/Deel folder names: "Act I - [X]", "Deel II - [X]" */
const ACT_FOLDER_RE = /^(Act|Deel)\s+(I{1,3}|IV|V)(?:\s*[-–—]\s*(.+))?$/;

/** Matches chapter filenames: "Chapter8.md", "chapter 12.md" */
const CHAPTER_NUM_RE = /(?:chapter|hoofdstuk)\s*(\d+)/i;

/** Matches H1 headings in markdown */
const H1_RE = /^\s*#\s+(.+?)\s*$/m;

/** Matches non-slug characters */
const SLUG_CLEAN_RE = /[^\p{L}\p{N}\s-]/gu;

/** Matches multiple blank lines */
const BLANK_LINES_RE = /\n{2,}/g;

/** Matches first H1 for demotion to H2 */
const FIRST_H1_RE = /^(\s*)#\s+/m;

/** Matches heading line for image insertion */
const HEADING_LINE_RE = /^#[^\n]*\n/m;

/** Matches book title row in translation notes */
const BOOK_TITLE_RE = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*Name of the book\s*\|\s*$/m;

// ─── UK Conversion (US → UK) ───────────────────────────────────────────────

export interface UkReplacement {
    us: string;
    uk: string;
}

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

const FENCE_RE = /^\s*```/;

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
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

        const converted = line.replace(replacementData.pattern, (match) => {
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

function isUkLanguage(lang: LanguageConfig): boolean {
    return lang.code.trim().toUpperCase() === 'UK' || lang.folderName.trim().toUpperCase() === 'UK';
}

function prepareUkFromEn(root: string, storyFolder: string, lang: LanguageConfig, customReplacements: UkReplacement[] = []): void {
    if (!isUkLanguage(lang)) {
        return;
    }

    const storyRoot = path.join(root, storyFolder);
    const enPath = path.join(storyRoot, 'EN');
    const ukPath = path.join(storyRoot, lang.folderName);

    if (!fs.existsSync(enPath)) {
        throw new Error(`EN source folder not found for UK generation: ${enPath}`);
    }

    if (fs.existsSync(ukPath)) {
        fs.rmSync(ukPath, { recursive: true, force: true });
    }

    fs.cpSync(enPath, ukPath, { recursive: true });
    convertUsToUkDirectory(ukPath, customReplacements);
}

function cleanupUkTempFolder(root: string, storyFolder: string, lang: LanguageConfig): void {
    if (!isUkLanguage(lang)) {
        return;
    }

    const ukPath = path.join(root, storyFolder, lang.folderName);
    if (fs.existsSync(ukPath)) {
        fs.rmSync(ukPath, { recursive: true, force: true });
    }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

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
    return m ? parseInt(m[1], 10) : undefined;
}

function generateSlug(text: string): string {
    return text
        .toLowerCase()
        .replace(SLUG_CLEAN_RE, '')
        .trim()
        .split(/\s+/)
        .join('-');
}

function demoteH1ToH2(text: string): string {
    return text.replace(FIRST_H1_RE, '$1## ');
}

function collapseBlankLines(text: string): string {
    return text.replace(BLANK_LINES_RE, '\n\n');
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
    // Also check for localized name
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

    // Process each act
    for (const act of acts) {
        files.push({ filePath: actFolders.get(act.number)!, fileType: { kind: 'act', act } });

        // Discover chapters in act folder
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
    let currentAct: number | null = null;

    for (const file of files) {
        let title: string;

        switch (file.fileType.kind) {
            case 'prologue':
                title = lang.prologueLabel;
                toc += `- [${title}](#${generateSlug(title)})\n`;
                break;

            case 'act':
                currentAct = file.fileType.act.number;
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
    return `![](${imagePath.replace(/\\/g, '/')})\n\n`;
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
    return `![](${coverPath.replace(/\\/g, '/')})\n\n`;
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

// ─── Pandoc Invocation ──────────────────────────────────────────────────────

function getBookTitle(root: string, lang: LanguageConfig): string {
    const notesPath = path.join(root, 'Notes', 'Details_Translation_notes.md');
    if (!fs.existsSync(notesPath)) { return 'Book'; }

    try {
        const content = fs.readFileSync(notesPath, 'utf-8');
        const m = BOOK_TITLE_RE.exec(content);
        if (m) {
            const useEnglishTitle = lang.code.toUpperCase() === 'EN' || lang.code.toUpperCase() === 'UK';
            const idx = useEnglishTitle ? 1 : 2;
            const title = m[idx]?.trim();
            if (title) { return title; }
        }
    } catch { /* ignore */ }

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

async function checkPandocOutputSupport(pandocPath: string, outputType: OutputType): Promise<boolean> {
    return new Promise((resolve) => {
        cp.execFile(pandocPath, ['--list-output-formats'], { encoding: 'utf-8' }, (err, stdout) => {
            if (err) {
                resolve(false);
                return;
            }
            const formats = stdout.split(/\r?\n/).map(v => v.trim().toLowerCase());
            resolve(formats.includes(outputType));
        });
    });
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

    // Language metadata
    const langCode = lang.code.toLowerCase();
    args.push('--metadata', `lang=${langCode}`);

    // Date metadata
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

function isMissingPdfEngineError(message: string): boolean {
    return /pdflatex not found|pdf-engine|program not found/i.test(message);
}

/**
 * Run LibreOffice headless to convert a DOCX to PDF.
 * LibreOffice writes <basename>.pdf into outputDir — we then rename it to finalPdfPath.
 */
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
                        'Make sure LibreOffice is installed and bindery.libreOfficePath is correct.'
                    ));
                    return;
                }
                // LibreOffice outputs <basename-without-ext>.pdf in outputDir
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

// ─── Format + Merge Entry Point ─────────────────────────────────────────────

/**
 * Format all markdown files in a directory tree (typography).
 */
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

/**
 * Main merge entry point.
 */
export async function mergeBook(options: MergeOptions): Promise<MergeResult> {
    prepareUkFromEn(options.root, options.storyFolder, options.language, options.ukReplacements ?? []);

    try {
        const langPath = path.join(options.root, options.storyFolder, options.language.folderName);

        if (!fs.existsSync(langPath)) {
            throw new Error(`Language folder not found: ${langPath}`);
        }

        // Format files first (same as Rust version)
        formatDirectory(langPath);

        // Discover and order files
        const files = getOrderedFiles(langPath, options.language);
        if (files.length === 0) {
            throw new Error(`No markdown files found in ${langPath}`);
        }

        // Create output directory
        const outputDir = path.join(options.root, options.outputDir);
        fs.mkdirSync(outputDir, { recursive: true });

        const baseName = `${options.filePrefix}_${options.language.folderName}_Merged`;
        const outputs: string[] = [];
        const warnings: string[] = [];

        // Check pandoc availability if needed (PDF also needs pandoc for the intermediate DOCX)
        const needsPandoc = options.outputTypes.some(t => t === 'docx' || t === 'epub' || t === 'pdf');
        if (needsPandoc) {
            await checkPandoc(options.pandocPath);
        }

        // Determine book title
        const title = options.bookTitle || getBookTitle(options.root, options.language);

        for (const outputType of options.outputTypes) {
            const outputPath = path.join(outputDir, `${baseName}.${outputType}`);

            if (outputType === 'md') {
                const content = buildMarkdownContent(files, options);
                fs.writeFileSync(outputPath, content, 'utf-8');
                outputs.push(outputPath);
            } else if (outputType === 'pdf') {
                // PDF: generate an intermediate DOCX via pandoc, then convert with LibreOffice
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
                // DOCX / EPUB: build pandoc-specific markdown and call pandoc directly
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
        cleanupUkTempFolder(options.root, options.storyFolder, options.language);
    }
}
