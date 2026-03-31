# Bindery

Markdown book authoring tools for VS Code: typography formatting (curly quotes, em-dashes, ellipses), multi-language chapter export (DOCX, EPUB, PDF), and dialect conversion.

## Features

### Typography Formatting

Converts plain-text typography to professional typographic characters:

| Input | Output | Description |
|-------|------—|-------------|
| `…` | `…` | Ellipsis |
| `—` | `—` | Em-dash (preserves `---` for markdown HR) |
| `”text”` | `”text”` | Curly double quotes |
| `’text’` | `’text’` | Curly single quotes |
| `don’t` | `don’t` | Smart apostrophes |

HTML comments are preserved and not modified.

**How to use:**

- **Right-click** a markdown file → **Format Typography**
- **Format Document** (`Shift+Alt+F`) — registered as a markdown formatter
- **Format on Save** — enable `bindery.formatOnSave` in settings
- **Explorer** — right-click a folder → **Format All Markdown in Folder**

### Chapter Merge & Export

Merges ordered chapter files into a single document with TOC generation:

- **Markdown** (`.md`) — with table of contents and separators
- **DOCX** (`.docx`) — via Pandoc, with page breaks and optional cover image
- **EPUB** (`.epub`) — via Pandoc, with chapter splitting and optional cover
- **PDF** (`.pdf`) — via Pandoc (intermediate DOCX) + LibreOffice headless conversion, giving consistent output quality across all platforms

For `UK` exports, the extension auto-generates `Story/UK` from `Story/EN` at export time, applies US→UK spelling conversion before merge, and removes `Story/UK` again after export completes.

**How to use:**

- **Editor toolbar** — click the $(book) **Bindery Export** button (visible on markdown files)
- **Command Palette** (`Ctrl+Shift+P`) → search “Bindery”

Supported commands:
- `Bindery: Merge Chapters → Markdown`
- `Bindery: Merge Chapters → DOCX`
- `Bindery: Merge Chapters → EPUB`
- `Bindery: Merge Chapters → PDF`
- `Bindery: Merge Chapters → All Formats`
- `Bindery: Find Probable US→UK Words`
- `Bindery: Add Substitution Rule`
- `Bindery: Initialise Workspace`
- `Bindery: Setup AI Assistant Files`

### File Discovery

The extension automatically discovers and orders your chapter files:

```
Story/
  EN/                          ← language folder
    Prologue.md                ← first
    Act I - Awakening/         ← act folders (sorted by Roman numeral)
      Chapter1.md              ← chapters (sorted by number)
      Chapter2.md
    Act II - Resonance/
      Chapter9.md
    Epilogue.md                ← last
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `bindery.storyFolder` | `”Story”` | Folder containing language subfolders |
| `bindery.languages` | EN | Language configurations (see below) |
| `bindery.mergedOutputDir` | `”Merged”` | Output directory for merged files |
| `bindery.author` | `””` | Author name for EPUB/DOCX metadata |
| `bindery.bookTitle` | `””` | Book title (auto-detected if empty) |
| `bindery.pandocPath` | `”pandoc”` | Path to Pandoc executable |
| `bindery.libreOfficePath` | `”libreoffice”` | Path to LibreOffice executable for PDF export. On Linux/WSL: `libreoffice` (default). On Windows: full path to `soffice.exe`, e.g. `C:\Program Files\LibreOffice\program\soffice.exe` |
| `bindery.formatOnSave` | `false` | Auto-format typography on save |
| `bindery.mergeFilePrefix` | `”Book”` | Prefix for output filenames |
| `bindery.generalSubstitutions` | `[]` | Dialect substitution rules applied across all projects |

### Dialect Conversion

Substitution rules are applied in tiers (later tiers win):
1. **Built-in** — common US→UK conversions
2. **General** — `bindery.generalSubstitutions` in VS Code user settings
3. **Project** — `.bindery/translations.json` in the workspace

You can extend conversion rules without editing code:

- Run `Bindery: Find Probable US→UK Words` to scan `Story/EN` for likely US spellings (like `-ize` forms), then add selected entries.
- Run `Bindery: Add Substitution Rule` to manually add one mapping.

### Language Configuration

Each language entry supports:

```json
{
  “code”: “EN”,
  “folderName”: “EN”,
  “chapterWord”: “Chapter”,
  “actPrefix”: “Act”,
  “prologueLabel”: “Prologue”,
  “epilogueLabel”: “Epilogue”
}
```

### Adding a New Language

Add to `.bindery/settings.json` (or `bindery.languages` in VS Code settings):

```json
{
  “languages”: [
    { “code”: “EN”, “folderName”: “EN”, “chapterWord”: “Chapter”, “actPrefix”: “Act”, “prologueLabel”: “Prologue”, “epilogueLabel”: “Epilogue” },
    { “code”: “FR”, “folderName”: “FR”, “chapterWord”: “Chapitre”, “actPrefix”: “Acte”, “prologueLabel”: “Prologue”, “epilogueLabel”: “Épilogue” }
  ]
}
```

## Requirements

- **VS Code** 1.85+
- **Pandoc** (needed for DOCX/EPUB/PDF export) — [Install](https://pandoc.org/installing.html)
- **LibreOffice** (needed for PDF export) — used to convert the intermediate DOCX to PDF
  - Linux/WSL: `sudo apt install libreoffice`
  - Windows: [Download from libreoffice.org](https://www.libreoffice.org/download/download-libreoffice/), then set `bindery.libreOfficePath` to the full path of `soffice.exe` (e.g. `C:\Program Files\LibreOffice\program\soffice.exe`)

## Building from Source

```bash
cd vscode-ext
npm install
npm run compile
```

To install locally:

```bash
npm install -g @vscode/vsce
vsce package
code —install-extension bindery-0.2.0.vsix
```
