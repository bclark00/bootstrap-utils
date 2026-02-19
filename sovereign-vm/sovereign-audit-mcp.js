'use strict';

/**
 * Sovereign Audit MCP Server
 * 
 * Capability: fs_read, net_dial (optional)
 * Deps: NONE (Node.js built-ins only)
 * Credentials: NONE
 * Replaces: audit-nexus/mcp-server.js
 * Clean delta: Complete rewrite with zero external dependencies
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

// Configuration
const SOVEREIGN_FS_ROOT = process.env.SOVEREIGN_FS_ROOT || process.cwd();
const SERVER_NAME = 'sovereign-audit-mcp';
const SERVER_VERSION = '1.0.0';

// Global state
const snapshots = new Map();
let watchSession = null;

// Self-integrity check
function computeSelfHash() {
    try {
        const content = fs.readFileSync(__filename, 'utf8');
        return crypto.createHash('sha256').update(content).digest('hex');
    } catch (err) {
        return 'error:' + err.message;
    }
}

// Logging to stderr only
function log(level, message, data = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...data
    };
    process.stderr.write(JSON.stringify(entry) + '\n');
}

// Compute SHA256 of file content
function hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

// Recursively walk directory tree
async function walkDirectory(dir, baseDir = dir) {
    const results = [];
    
    async function walk(currentDir) {
        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const relativePath = path.relative(baseDir, fullPath);
            
            if (entry.isDirectory()) {
                await walk(fullPath);
            } else if (entry.isFile()) {
                try {
                    const stats = await fs.promises.stat(fullPath);
                    const sha256 = await hashFile(fullPath);
                    results.push({
                        path: relativePath,
                        sha256,
                        size: stats.size,
                        mtime: stats.mtime.toISOString()
                    });
                } catch (err) {
                    log('warn', 'Failed to process file', { path: fullPath, error: err.message });
                }
            }
        }
    }
    
    await walk(dir);
    return results.sort((a, b) => a.path.localeCompare(b.path));
}

// Create manifest hash from file list
function computeManifestHash(files) {
    const manifestContent = files
        .map(f => `${f.path}:${f.sha256}:${f.size}:${f.mtime}`)
        .join('\n');
    return crypto.createHash('sha256').update(manifestContent).digest('hex');
}

// Tool implementations
async function auditStart() {
    if (watchSession) {
        return {
            watching: SOVEREIGN_FS_ROOT,
            session_id: watchSession
        };
    }
    
    watchSession = crypto.randomBytes(16).toString('hex');
    log('info', 'Audit session started', { session_id: watchSession, root: SOVEREIGN_FS_ROOT });
    
    return {
        watching: SOVEREIGN_FS_ROOT,
        session_id: watchSession
    };
}

async function auditSnapshot() {
    const files = await walkDirectory(SOVEREIGN_FS_ROOT);
    const manifestHash = computeManifestHash(files);
    
    snapshots.set(manifestHash, files);
    
    log('info', 'Snapshot created', { 
        manifest_sha256: manifestHash, 
        file_count: files.length 
    });
    
    return {
        files,
        manifest_sha256: manifestHash
    };
}

async function auditDiff({ since_snapshot }) {
    if (!snapshots.has(since_snapshot)) {
        throw new Error(`Snapshot not found: ${since_snapshot}`);
    }
    
    const oldFiles = snapshots.get(since_snapshot);
    const currentFiles = await walkDirectory(SOVEREIGN_FS_ROOT);
    const currentManifest = computeManifestHash(currentFiles);
    
    // Create lookup maps
    const oldMap = new Map(oldFiles.map(f => [f.path, f]));
    const currentMap = new Map(currentFiles.map(f => [f.path, f]));
    
    const changed = [];
    const added = [];
    const deleted = [];
    
    // Check for changes and additions
    for (const [path, current] of currentMap) {
        if (oldMap.has(path)) {
            const old = oldMap.get(path);
            if (old.sha256 !== current.sha256) {
                changed.push({
                    path,
                    old_sha256: old.sha256,
                    new_sha256: current.sha256,
                    size: current.size,
                    mtime: current.mtime
                });
            }
        } else {
            added.push({
                path,
                sha256: current.sha256,
                size: current.size,
                mtime: current.mtime
            });
        }
    }
    
    // Check for deletions
    for (const [path, old] of oldMap) {
        if (!currentMap.has(path)) {
            deleted.push({
                path,
                old_sha256: old.sha256,
                old_size: old.size
            });
        }
    }
    
    snapshots.set(currentManifest, currentFiles);
    
    return {
        changed,
        added,
        deleted,
        manifest_sha256: currentManifest
    };
}

async function auditVerify({ path: relativePath, expected_sha256 }) {
    const fullPath = path.join(SOVEREIGN_FS_ROOT, relativePath);
    
    try {
        const actualSha256 = await hashFile(fullPath);
        const match = actualSha256 === expected_sha256;
        
        log('info', 'File verification', { 
            path: relativePath, 
            match,
            expected: expected_sha256,
            actual: actualSha256
        });
        
        return {
            match,
            actual_sha256: actualSha256
        };
    } catch (err) {
        log('error', 'Verification failed', { path: relativePath, error: err.message });
        throw err;
    }
}

async function auditSelf() {
    const selfHash = computeSelfHash();
    
    return {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        sha256: selfHash,
        capabilities: ['fs_read', 'net_dial'],
        deps: [],
        credentials: []
    };
}

// MCP Protocol handling
const toolHandlers = {
    audit_start: auditStart,
    audit_snapshot: auditSnapshot,
    audit_diff: auditDiff,
    audit_verify: auditVerify,
    audit_self: auditSelf
};

async function handleRequest(request) {
    const { id, method, params } = request;
    
    if (method === 'initialize') {
        return {
            protocolVersion: "1.0",
            capabilities: {
                tools: Object.keys(toolHandlers).map(name => ({
                    name,
                    description: `${name} tool`
                }))
            },
            serverInfo: {
                name: SERVER_NAME,
                version: SERVER_VERSION
            }
        };
    }
    
    if (method === 'tools/list') {
        return {
            tools: Object.keys(toolHandlers).map(name => ({
                name,
                description: `${name} tool`,
                inputSchema: { type: "object" }
            }))
        };
    }
    
    if (method === 'tools/call') {
        const { name, arguments: args } = params;
        if (!toolHandlers[name]) {
            throw new Error(`Unknown tool: ${name}`);
        }
        
        try {
            const result = await toolHandlers[name](args || {});
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                }],
                isError: false
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: error.message
                }],
                isError: true
            };
        }
    }
    
    throw new Error(`Unknown method: ${method}`);
}

// Main server loop
async function main() {
    // Self-integrity report on startup
    const selfHash = computeSelfHash();
    log('info', 'Server startup', { 
        name: SERVER_NAME,
        version: SERVER_VERSION,
        sha256: selfHash,
        root: SOVEREIGN_FS_ROOT,
        pid: process.pid
    });
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: null,
        terminal: false
    });
    
    rl.on('line', async (line) => {
        try {
            const request = JSON.parse(line);
            const result = await handleRequest(request);
            
            const response = {
                jsonrpc: "2.0",
                id: request.id,
                result
            };
            
            process.stdout.write(JSON.stringify(response) + '\n');
        } catch (error) {
            const errorResponse = {
                jsonrpc: "2.0",
                id: request?.id || null,
                error: {
                    code: -32603,
                    message: error.message
                }
            };
            
            process.stdout.write(JSON.stringify(errorResponse) + '\n');
            log('error', 'Request processing failed', { error: error.message });
        }
    });
    
    rl.on('close', () => {
        log('info', 'Server shutdown');
        process.exit(0);
    });
}

// Handle uncaught errors
process.on('uncaughtException', (err) => {
    log('error', 'Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    log('error', 'Unhandled rejection', { reason: String(reason) });
    process.exit(1);
});

// Start server
main().catch(err => {
    log('error', 'Fatal error', { error: err.message });
    process.exit(1);
});