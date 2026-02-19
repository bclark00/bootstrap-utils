#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

// Configuration
const SOVEREIGN_PIPES = (process.env.SOVEREIGN_PIPES || '').split(',').filter(Boolean);
const VERSION = '1.0.0';

// State management
const pipeStates = new Map();
const activeListeners = new Map();

// Initialize pipe states
SOVEREIGN_PIPES.forEach(pipeName => {
    pipeStates.set(pipeName, {
        state: 'idle',
        frames_seen: 0,
        last_frame_sha256: null,
        frames: []
    });
});

// Self-integrity check
function selfIntegrity() {
    const content = fs.readFileSync(__filename, 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    process.stderr.write(`[SOVEREIGN-PIPE-MCP] v${VERSION} SHA256: ${hash}\n`);
    process.stderr.write(`[SOVEREIGN-PIPE-MCP] Monitoring pipes: ${SOVEREIGN_PIPES.join(', ') || 'none'}\n`);
    return hash;
}

const SELF_HASH = selfIntegrity();

// Frame detection helpers
function detectFraming(buffer) {
    // Check for length-prefixed (first 4 bytes as uint32)
    if (buffer.length >= 4) {
        const len = buffer.readUInt32BE(0);
        if (len > 0 && len < 1024 * 1024 && buffer.length >= len + 4) {
            return { type: 'length-prefixed', frameSize: len + 4 };
        }
    }
    
    // Check for newline-delimited
    const newlineIndex = buffer.indexOf('\n');
    if (newlineIndex !== -1) {
        return { type: 'newline', frameSize: newlineIndex + 1 };
    }
    
    return null;
}

// Pipe listener
function createPipeListener(pipeName, duration_ms, captureFrames = true) {
    return new Promise((resolve) => {
        const pipePath = `\\\\.\\pipe\\${pipeName}`;
        const state = pipeStates.get(pipeName);
        const frames = [];
        let server;
        let timeout;
        
        const cleanup = () => {
            if (timeout) clearTimeout(timeout);
            if (server) {
                server.close();
                activeListeners.delete(pipeName);
            }
            state.state = 'idle';
            resolve({ frames, count: frames.length });
        };
        
        state.state = 'listening';
        state.frames = [];
        
        server = net.createServer((client) => {
            let buffer = Buffer.alloc(0);
            
            client.on('data', (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);
                
                while (true) {
                    const framing = detectFraming(buffer);
                    if (!framing) break;
                    
                    const frameData = buffer.slice(0, framing.frameSize);
                    const hash = crypto.createHash('sha256').update(frameData).digest('hex');
                    
                    state.frames_seen++;
                    state.last_frame_sha256 = hash;
                    
                    if (captureFrames) {
                        frames.push({
                            ts: new Date().toISOString(),
                            dir: 'inbound',
                            data_sha256: hash,
                            size: frameData.length
                        });
                    }
                    
                    buffer = buffer.slice(framing.frameSize);
                }
            });
            
            client.on('error', () => {});
            client.on('end', () => {});
        });
        
        server.on('error', (err) => {
            state.state = 'error';
            cleanup();
        });
        
        server.listen(pipePath, () => {
            activeListeners.set(pipeName, server);
            timeout = setTimeout(cleanup, duration_ms);
        });
    });
}

// MCP request handlers
const handlers = {
    pipe_list: async () => {
        return Array.from(pipeStates.entries()).map(([name, state]) => ({
            name,
            state: state.state,
            frames_seen: state.frames_seen
        }));
    },
    
    pipe_listen: async ({ name, duration_ms }) => {
        if (!SOVEREIGN_PIPES.includes(name)) {
            throw new Error(`Pipe ${name} not in SOVEREIGN_PIPES`);
        }
        if (activeListeners.has(name)) {
            throw new Error(`Already listening to pipe ${name}`);
        }
        return await createPipeListener(name, duration_ms);
    },
    
    pipe_snapshot: async ({ name }) => {
        if (!SOVEREIGN_PIPES.includes(name)) {
            throw new Error(`Pipe ${name} not in SOVEREIGN_PIPES`);
        }
        const state = pipeStates.get(name);
        return {
            name,
            state: state.state,
            last_frame_sha256: state.last_frame_sha256,
            total_frames: state.frames_seen
        };
    },
    
    pipe_self: async () => {
        return {
            name: 'sovereign-pipe-mcp',
            version: VERSION,
            sha256: SELF_HASH,
            capabilities: ['net_pipe', 'net_listen'],
            deps: [],
            credentials: []
        };
    }
};

// MCP protocol implementation
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

function sendResponse(id, result, error = null) {
    const response = {
        jsonrpc: '2.0',
        id,
        ...(error ? { error } : { result })
    };
    console.log(JSON.stringify(response));
}

rl.on('line', async (line) => {
    try {
        const request = JSON.parse(line);
        
        if (request.method === 'initialize') {
            sendResponse(request.id, {
                protocolVersion: '1.0',
                serverInfo: {
                    name: 'sovereign-pipe-mcp',
                    version: VERSION
                },
                capabilities: {
                    tools: {
                        pipe_list: {},
                        pipe_listen: { name: 'string', duration_ms: 'number' },
                        pipe_snapshot: { name: 'string' },
                        pipe_self: {}
                    }
                }
            });
        } else if (request.method === 'tools/call') {
            const { name, arguments: args } = request.params;
            if (handlers[name]) {
                try {
                    const result = await handlers[name](args || {});
                    sendResponse(request.id, { toolResult: result });
                } catch (err) {
                    sendResponse(request.id, null, {
                        code: -32603,
                        message: err.message
                    });
                }
            } else {
                sendResponse(request.id, null, {
                    code: -32601,
                    message: `Unknown tool: ${name}`
                });
            }
        } else {
            sendResponse(request.id, { result: 'ok' });
        }
    } catch (err) {
        process.stderr.write(`[SOVEREIGN-PIPE-MCP] Error: ${err.message}\n`);
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    activeListeners.forEach(server => server.close());
    process.exit(0);
});