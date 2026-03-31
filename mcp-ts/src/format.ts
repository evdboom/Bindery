/**
 * Typography formatting — shared between mcp-ts and vscode-ext.
 * Identical to vscode-ext/src/format.ts.
 */

const OPEN_DOUBLE  = '\u201C';
const CLOSE_DOUBLE = '\u201D';
const OPEN_SINGLE  = '\u2018';
const CLOSE_SINGLE = '\u2019';
const ELLIPSIS     = '\u2026';
const EM_DASH      = '\u2014';

const COMMENT_RE                  = /<!--[\s\S]*?-->/g;
const OPEN_DOUBLE_RE              = /(^|[\s([{—–-])"/gm;
const OPEN_SINGLE_RE              = /(^|[\s([{—–-])'/gm;
const CLOSE_DOUBLE_AFTER_EM_DASH_RE = /—"([\s)\].,;:!?]|$)/gm;

export function updateTypography(text: string): string {
    let result = text;

    result = result.replace(/\.\.\./g, ELLIPSIS);

    const protectedComments: string[] = [];
    result = result.replace(COMMENT_RE, (match) => {
        const placeholder = `\x00COMMENT${protectedComments.length}\x00`;
        protectedComments.push(match);
        return placeholder;
    });

    const protectedTriple = '\x00TRIPLE\x00';
    result = result.replace(/---/g, protectedTriple);
    result = result.replace(/--/g, EM_DASH);
    result = result.replace(new RegExp(escapeRegex(protectedTriple), 'g'), '---');

    for (let i = 0; i < protectedComments.length; i++) {
        result = result.replace(`\x00COMMENT${i}\x00`, protectedComments[i]);
    }

    result = result.replace(CLOSE_DOUBLE_AFTER_EM_DASH_RE, (_match, after) => {
        return `${EM_DASH}${CLOSE_DOUBLE}${after}`;
    });

    result = result.replace(OPEN_DOUBLE_RE, (_match, before) => `${before}${OPEN_DOUBLE}`);
    result = result.replace(/"/g, CLOSE_DOUBLE);
    result = result.replace(OPEN_SINGLE_RE, (_match, before) => `${before}${OPEN_SINGLE}`);
    result = result.replace(/'/g, CLOSE_SINGLE);

    return result;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
