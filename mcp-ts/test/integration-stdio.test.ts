/**
 * MCP stdio integration tests.
 *
 * Spawns the compiled MCP server as a real child process, exchanges
 * JSON-RPC 2.0 messages over stdio, and validates protocol compliance.
 *
 * Prerequisites: `npm run build` must have been run so `out/index.js` exists.
 */

import * as child_process from 'child_process';
import * as fs            from 'fs';
import * as os            from 'os';
import * as path          from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SERVER_SCRIPT = path.resolve(__dirname, '..', 'out', 'index.js');
const MSG_TIMEOUT_MS = 5000;

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id:      number;
    method:  string;
    params?: unknown;
}

interface JsonRpcNotification {
    jsonrpc: '2.0';
    method:  string;
    params?: unknown;
}

interface JsonRpcResponse {
    jsonrpc: string;
    id?:     number | null;
    result?: unknown;
    error?:  { code: number; message: string; data?: unknown };
}

/**
 * Spawns the MCP server process with a pre-configured book.
 * Returns the process and a helper to read the next newline-delimited JSON response.
 *
 * Security: the tempRoot is an OS temp directory created by mkdtempSync, never
 * derived from user-controlled input, so there is no path-injection risk here.
 */
function spawnServer(bookName: string, bookRoot: string): {
    proc:    child_process.ChildProcessWithoutNullStreams;
    send:    (msg: JsonRpcRequest | JsonRpcNotification) => void;
    readOne: () => Promise<JsonRpcResponse>;
    kill:    () => void;
} {
    const proc = child_process.spawn(
        process.execPath,
        [SERVER_SCRIPT, '--book', `${bookName}=${bookRoot}`],
        {
            stdio:  ['pipe', 'pipe', 'pipe'],
            // Never inherit the test process's env — keeps tests hermetic
            env:    { PATH: process.env['PATH'] ?? '' },
        }
    );

    let buffer = '';
    const pending: Array<(line: string) => void> = [];
    const lines:   string[] = [];

    proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) { continue; }
            const resolver = pending.shift();
            if (resolver) { resolver(line); } else { lines.push(line); }
        }
    });

    const readOne = (): Promise<JsonRpcResponse> =>
        new Promise((resolve, reject) => {
            const existing = lines.shift();
            if (existing) {
                try { resolve(JSON.parse(existing) as JsonRpcResponse); } catch (e) { reject(e); }
                return;
            }
            const timer = setTimeout(() => {
                const idx = pending.indexOf(handler);
                if (idx >= 0) { pending.splice(idx, 1); }
                reject(new Error(`Timed out waiting for MCP message after ${MSG_TIMEOUT_MS}ms`));
            }, MSG_TIMEOUT_MS);

            const handler = (line: string) => {
                clearTimeout(timer);
                try { resolve(JSON.parse(line) as JsonRpcResponse); } catch (e) { reject(e); }
            };
            pending.push(handler);
        });

    const send = (msg: JsonRpcRequest | JsonRpcNotification): void => {
        proc.stdin.write(JSON.stringify(msg) + '\n');
    };

    const kill = () => {
        try { proc.kill('SIGTERM'); } catch { /* already dead */ }
    };

    return { proc, send, readOne, kill };
}

/** Perform the mandatory MCP initialize handshake and return the server's init result. */
async function handshake(
    send:    (msg: JsonRpcRequest | JsonRpcNotification) => void,
    readOne: () => Promise<JsonRpcResponse>,
): Promise<JsonRpcResponse> {
    send({
        jsonrpc: '2.0',
        id:      1,
        method:  'initialize',
        params:  {
            protocolVersion: '2024-11-05',
            capabilities:    {},
            clientInfo:      { name: 'integration-test', version: '0.0.1' },
        },
    });

    const initResp = await readOne();

    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    return initResp;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const tempRoots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bindery-stdio-test-'));
    tempRoots.push(root);
    return root;
}

afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MCP stdio integration', () => {
    let kill: () => void = () => undefined;

    afterEach(() => { kill(); });

    it('server starts and completes initialize handshake', async () => {
        const root = makeRoot();
        const { send, readOne, kill: k } = spawnServer('TestBook', root);
        kill = k;

        const initResp = await handshake(send, readOne);

        expect(initResp.jsonrpc).toBe('2.0');
        expect(initResp.id).toBe(1);
        expect(initResp.error).toBeUndefined();
        expect((initResp.result as Record<string, unknown>)?.serverInfo).toBeDefined();
        expect(
            (initResp.result as Record<string, unknown>)?.protocolVersion
        ).toBeDefined();
    });

    it('list_books returns the configured book', async () => {
        const root = makeRoot();
        const { send, readOne, kill: k } = spawnServer('TestBook', root);
        kill = k;

        await handshake(send, readOne);

        send({
            jsonrpc: '2.0',
            id:      2,
            method:  'tools/call',
            params:  { name: 'list_books', arguments: {} },
        });

        const resp = await readOne();
        expect(resp.jsonrpc).toBe('2.0');
        expect(resp.id).toBe(2);
        expect(resp.error).toBeUndefined();

        const content = (resp.result as { content: Array<{ text: string }> })?.content;
        expect(Array.isArray(content)).toBe(true);
        // The text must contain the book name (not sensitive path data to the test runner)
        expect(content[0]?.text).toContain('TestBook');
    });

    it('health returns server status for a configured book', async () => {
        const root = makeRoot();
        const { send, readOne, kill: k } = spawnServer('MyNovel', root);
        kill = k;

        await handshake(send, readOne);

        send({
            jsonrpc: '2.0',
            id:      3,
            method:  'tools/call',
            params:  { name: 'health', arguments: { book: 'MyNovel' } },
        });

        const resp = await readOne();
        expect(resp.jsonrpc).toBe('2.0');
        expect(resp.id).toBe(3);
        expect(resp.error).toBeUndefined();

        const content = (resp.result as { content: Array<{ text: string }> })?.content;
        expect(content[0]?.text).toContain('root:');
    });

    it('get_text blocks a path-traversal attack and returns an error result', async () => {
        const root = makeRoot();
        // Create a sentinel file outside the book root to prove isolation
        const outsideRoot = path.dirname(root);
        const sentinelName = `sentinel-${Date.now()}.txt`;
        const sentinelPath = path.join(outsideRoot, sentinelName);
        fs.writeFileSync(sentinelPath, 'secret content', 'utf-8');

        const { send, readOne, kill: k } = spawnServer('AttackBook', root);
        kill = k;

        try {
            await handshake(send, readOne);

            // Attempt path traversal to read the sentinel file
            send({
                jsonrpc: '2.0',
                id:      4,
                method:  'tools/call',
                params:  {
                    name:      'get_text',
                    arguments: { book: 'AttackBook', identifier: `../../${sentinelName}` },
                },
            });

            const resp = await readOne();
            expect(resp.jsonrpc).toBe('2.0');
            expect(resp.id).toBe(4);

            // The server MUST NOT return the secret content — it should either
            // return an error response or a tool result containing "File not found"
            const text = JSON.stringify(resp);
            expect(text).not.toContain('secret content');
        } finally {
            // Clean up only the sentinel file — never rmSync the parent directory
            try { fs.unlinkSync(sentinelPath); } catch { /* already gone */ }
        }
    });

    it('unknown book name returns an error result (not a crash)', async () => {
        const root = makeRoot();
        const { send, readOne, kill: k } = spawnServer('RealBook', root);
        kill = k;

        await handshake(send, readOne);

        send({
            jsonrpc: '2.0',
            id:      5,
            method:  'tools/call',
            params:  { name: 'health', arguments: { book: 'NonExistentBook' } },
        });

        const resp = await readOne();
        expect(resp.jsonrpc).toBe('2.0');
        expect(resp.id).toBe(5);
        // Server wraps tool errors as isError:true results, not JSON-RPC errors
        const content = (resp.result as { content: Array<{ text: string }>; isError?: boolean })?.content;
        expect(content[0]?.text).toMatch(/unknown book|no books configured|not found/i);
    });

    it('request IDs are echoed back correctly for sequential calls', async () => {
        const root = makeRoot();
        const { send, readOne, kill: k } = spawnServer('SeqBook', root);
        kill = k;

        await handshake(send, readOne);

        // Send three calls with different IDs
        for (const id of [10, 20, 30]) {
            send({
                jsonrpc: '2.0',
                id,
                method:  'tools/call',
                params:  { name: 'list_books', arguments: {} },
            });
        }

        const ids: (number | undefined | null)[] = [];
        for (let i = 0; i < 3; i++) {
            const resp = await readOne();
            ids.push(resp.id);
        }

        expect(ids.sort()).toEqual([10, 20, 30]);
    });
});
