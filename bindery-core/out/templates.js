"use strict";
/**
 * Bindery AI instruction file templates — thin aggregator.
 *
 * Each template lives in its own file under `./templates/`. Each module
 * exports `{ meta, render }` so the version stays glued to the content.
 * This file just collects them and exposes the public API:
 *
 *   - `TemplateContext`   — re-exported from ./templates/context
 *   - `FILE_VERSION_INFO` — built from each module's `meta`
 *   - `renderTemplate(name, ctx)` — dispatches to the right module
 *
 * SINGLE SOURCE OF TRUTH — this is the canonical copy in bindery-core.
 * Do not hand-edit copies in mcp-ts/src/ or vscode-ext/src/.
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
exports.FILE_VERSION_INFO = void 0;
exports.renderTemplate = renderTemplate;
const claude = __importStar(require("./templates/claude"));
const copilot = __importStar(require("./templates/copilot"));
const cursor = __importStar(require("./templates/cursor"));
const agents = __importStar(require("./templates/agents"));
const binderyReadme = __importStar(require("./templates/bindery-readme"));
const review = __importStar(require("./templates/skills/review"));
const brainstorm = __importStar(require("./templates/skills/brainstorm"));
const memory = __importStar(require("./templates/skills/memory"));
const translate = __importStar(require("./templates/skills/translate"));
const translationReview = __importStar(require("./templates/skills/translation-review"));
const status = __importStar(require("./templates/skills/status"));
const continuity = __importStar(require("./templates/skills/continuity"));
const readAloud = __importStar(require("./templates/skills/read-aloud"));
const readIn = __importStar(require("./templates/skills/read-in"));
const proofRead = __importStar(require("./templates/skills/proof-read"));
const TEMPLATES = {
    'claude': claude,
    'copilot': copilot,
    'cursor': cursor,
    'agents': agents,
    'bindery-readme': binderyReadme,
    'review': review,
    'brainstorm': brainstorm,
    'memory': memory,
    'translate': translate,
    'translation-review': translationReview,
    'status': status,
    'continuity': continuity,
    'read-aloud': readAloud,
    'read-in': readIn,
    'proof-read': proofRead,
};
// ─── File version metadata ────────────────────────────────────────────────────
// Bump per-file version inside the matching module's `meta` when content
// changes significantly so users with outdated content are prompted.
exports.FILE_VERSION_INFO = Object.fromEntries(Object.values(TEMPLATES).map(t => [
    t.meta.file,
    { version: t.meta.version, label: t.meta.label, zip: t.meta.zip },
]));
// ─── Entry point ──────────────────────────────────────────────────────────────
/**
 * Render a named template with the given context.
 *
 * Top-level file templates: 'claude', 'copilot', 'cursor', 'agents', 'bindery-readme'
 * Skill templates: 'review', 'brainstorm', 'memory', 'translate',
 *                  'translation-review', 'status', 'continuity', 'read-aloud',
 *                  'read-in', 'proof-read'
 */
function renderTemplate(name, ctx) {
    const t = TEMPLATES[name];
    if (!t) {
        return `Unknown template: ${name}`;
    }
    return t.render(ctx);
}
//# sourceMappingURL=templates.js.map