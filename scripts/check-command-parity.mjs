#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const vscodePackagePath = path.join(repoRoot, 'vscode-ext', 'package.json');
const obsidianMainPath = path.join(repoRoot, 'obsidian-plugin', 'src', 'main.ts');

const vscodePackage = JSON.parse(fs.readFileSync(vscodePackagePath, 'utf-8'));
const obsidianMain = fs.readFileSync(obsidianMainPath, 'utf-8');

const vscodeCommands = new Set(
  (vscodePackage.contributes?.commands ?? [])
    .map(command => command.command)
    .filter(Boolean),
);

const obsidianCommands = new Set();
for (const match of obsidianMain.matchAll(/id:\s*['`]([^'`$]+)['`]/g)) {
  obsidianCommands.add(match[1]);
}

if (obsidianMain.includes('`merge-${fmt}`')) {
  for (const format of ['md', 'docx', 'epub', 'pdf', 'all']) {
    obsidianCommands.add(`merge-${format}`);
  }
}

const expectedPairs = [
  ['init', 'bindery.init', 'init-workspace'],
  ['setupAI', 'bindery.setupAI', 'setup-ai-files'],
  ['formatDocument', 'bindery.formatDocument', 'format-document'],
  ['formatFolder', 'bindery.formatFolder', 'format-folder'],
  ['mergeMarkdown', 'bindery.mergeMarkdown', 'merge-md'],
  ['mergeDocx', 'bindery.mergeDocx', 'merge-docx'],
  ['mergeEpub', 'bindery.mergeEpub', 'merge-epub'],
  ['mergePdf', 'bindery.mergePdf', 'merge-pdf'],
  ['mergeAll', 'bindery.mergeAll', 'merge-all'],
  ['findProbableUsToUkWords', 'bindery.findProbableUsToUkWords', 'find-us-to-uk-words'],
  ['addDialect', 'bindery.addDialect', 'add-dialect'],
  ['addTranslation', 'bindery.addTranslation', 'add-translation'],
  ['addLanguage', 'bindery.addLanguage', 'add-language'],
  ['openTranslations', 'bindery.openTranslations', 'open-translations'],
  ['startReviewMarker', 'bindery.startReviewMarker', 'start-review-marker'],
  ['stopReviewMarker', 'bindery.stopReviewMarker', 'stop-review-marker'],
  ['noteList', 'bindery.noteList', 'note-list'],
  ['noteGet', 'bindery.noteGet', 'note-get'],
  ['noteCreate', 'bindery.noteCreate', 'note-create'],
  ['noteAppend', 'bindery.noteAppend', 'note-append'],
  ['characterList', 'bindery.characterList', 'character-list'],
  ['characterGet', 'bindery.characterGet', 'character-get'],
  ['characterCreate', 'bindery.characterCreate', 'character-create'],
  ['characterUpdate', 'bindery.characterUpdate', 'character-update'],
  ['arcList', 'bindery.arcList', 'arc-list'],
  ['arcGet', 'bindery.arcGet', 'arc-get'],
  ['arcCreate', 'bindery.arcCreate', 'arc-create'],
  ['arcUpdate', 'bindery.arcUpdate', 'arc-update'],
  ['memoryList', 'bindery.memoryList', 'memory-list'],
  ['memoryAppend', 'bindery.memoryAppend', 'memory-append'],
  ['memoryCompact', 'bindery.memoryCompact', 'memory-compact'],
  ['sessionFocusShow', 'bindery.sessionFocusShow', 'session-focus-show'],
  ['sessionFocusUpdate', 'bindery.sessionFocusUpdate', 'session-focus-update'],
  ['sessionFocusAppendHandoff', 'bindery.sessionFocusAppendHandoff', 'session-focus-append-handoff'],
  ['inboxProcess', 'bindery.inboxProcess', 'inbox-process'],
  ['inboxResolve', 'bindery.inboxResolve', 'inbox-resolve'],
];

const exceptions = [
  ['registerMcp', 'bindery.registerMcp', null, 'VS Code-only MCP discovery writer'],
  ['showMcpConfig', null, 'show-mcp-config', 'Obsidian-only MCP snippet display'],
  ['quickActions', 'bindery.quickActions', null, 'VS Code-only status-bar quick menu'],
  ['addUkReplacement', 'bindery.addUkReplacement', null, 'VS Code backward-compatibility alias'],
];

const failures = [];
for (const [concept, vscodeCommand, obsidianCommand] of expectedPairs) {
  if (!vscodeCommands.has(vscodeCommand)) {
    failures.push(`${concept}: missing VS Code command ${vscodeCommand}`);
  }
  if (!obsidianCommands.has(obsidianCommand)) {
    failures.push(`${concept}: missing Obsidian command ${obsidianCommand}`);
  }
}

for (const [concept, vscodeCommand, obsidianCommand, reason] of exceptions) {
  if (vscodeCommand && !vscodeCommands.has(vscodeCommand)) {
    failures.push(`${concept}: missing expected VS Code exception ${vscodeCommand} (${reason})`);
  }
  if (obsidianCommand && !obsidianCommands.has(obsidianCommand)) {
    failures.push(`${concept}: missing expected Obsidian exception ${obsidianCommand} (${reason})`);
  }
}

console.log(`Checked ${expectedPairs.length} shared command concepts.`);
console.log(`Exceptions: ${exceptions.map(([concept]) => concept).join(', ')}`);

if (failures.length > 0) {
  console.error('\nCommand parity check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('VS Code and Obsidian command surfaces agree.');
