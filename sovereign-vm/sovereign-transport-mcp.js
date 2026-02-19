const crypto = require('crypto');
const readline = require('readline');

// Pure JS MessagePack-lite implementation (minimal subset)
const msgpack = {
  encode(obj) {
    const buffer = [];
    this._encode(obj, buffer);
    return Buffer.from(buffer);
  },
  
  decode(buf) {
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
    return this._decode(buf, { offset: 0 });
  },
  
  _encode(obj, buffer) {
    if (obj === null) {
      buffer.push(0xc0);
    } else if (typeof obj === 'boolean') {
      buffer.push(obj ? 0xc3 : 0xc2);
    } else if (typeof obj === 'number' && Number.isInteger(obj)) {
      if (obj >= 0 && obj <= 127) {
        buffer.push(obj);
      } else if (obj < 0 && obj >= -32) {
        buffer.push(obj & 0xff);
      } else if (obj >= -128 && obj <= 127) {
        buffer.push(0xd0, obj & 0xff);
      } else if (obj >= -32768 && obj <= 32767) {
        buffer.push(0xd1, (obj >> 8) & 0xff, obj & 0xff);
      } else {
        buffer.push(0xd2, (obj >> 24) & 0xff, (obj >> 16) & 0xff, (obj >> 8) & 0xff, obj & 0xff);
      }
    } else if (typeof obj === 'string') {
      const bytes = Buffer.from(obj, 'utf8');
      if (bytes.length <= 31) {
        buffer.push(0xa0 | bytes.length);
      } else if (bytes.length <= 255) {
        buffer.push(0xd9, bytes.length);
      } else if (bytes.length <= 65535) {
        buffer.push(0xda, (bytes.length >> 8) & 0xff, bytes.length & 0xff);
      }
      for (let i = 0; i < bytes.length; i++) {
        buffer.push(bytes[i]);
      }
    } else if (Array.isArray(obj)) {
      if (obj.length <= 15) {
        buffer.push(0x90 | obj.length);
      } else if (obj.length <= 65535) {
        buffer.push(0xdc, (obj.length >> 8) & 0xff, obj.length & 0xff);
      }
      for (const item of obj) {
        this._encode(item, buffer);
      }
    } else if (typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length <= 15) {
        buffer.push(0x80 | keys.length);
      } else if (keys.length <= 65535) {
        buffer.push(0xde, (keys.length >> 8) & 0xff, keys.length & 0xff);
      }
      for (const key of keys) {
        this._encode(key, buffer);
        this._encode(obj[key], buffer);
      }
    }
  },
  
  _decode(buf, state) {
    const byte = buf[state.offset++];
    
    if (byte === 0xc0) return null;
    if (byte === 0xc2) return false;
    if (byte === 0xc3) return true;
    
    if ((byte & 0x80) === 0) return byte;
    if ((byte & 0xe0) === 0xe0) return byte - 256;
    
    if (byte === 0xd0) return buf.readInt8(state.offset++);
    if (byte === 0xd1) {
      const val = buf.readInt16BE(state.offset);
      state.offset += 2;
      return val;
    }
    if (byte === 0xd2) {
      const val = buf.readInt32BE(state.offset);
      state.offset += 4;
      return val;
    }
    
    if ((byte & 0xe0) === 0xa0) {
      const len = byte & 0x1f;
      const str = buf.toString('utf8', state.offset, state.offset + len);
      state.offset += len;
      return str;
    }
    if (byte === 0xd9) {
      const len = buf[state.offset++];
      const str = buf.toString('utf8', state.offset, state.offset + len);
      state.offset += len;
      return str;
    }
    if (byte === 0xda) {
      const len = buf.readUInt16BE(state.offset);
      state.offset += 2;
      const str = buf.toString('utf8', state.offset, state.offset + len);
      state.offset += len;
      return str;
    }
    
    if ((byte & 0xf0) === 0x90) {
      const len = byte & 0x0f;
      const arr = [];
      for (let i = 0; i < len; i++) {
        arr.push(this._decode(buf, state));
      }
      return arr;
    }
    if (byte === 0xdc) {
      const len = buf.readUInt16BE(state.offset);
      state.offset += 2;
      const arr = [];
      for (let i = 0; i < len; i++) {
        arr.push(this._decode(buf, state));
      }
      return arr;
    }
    
    if ((byte & 0xf0) === 0x80) {
      const len = byte & 0x0f;
      const obj = {};
      for (let i = 0; i < len; i++) {
        const key = this._decode(buf, state);
        obj[key] = this._decode(buf, state);
      }
      return obj;
    }
    if (byte === 0xde) {
      const len = buf.readUInt16BE(state.offset);
      state.offset += 2;
      const obj = {};
      for (let i = 0; i < len; i++) {
        const key = this._decode(buf, state);
        obj[key] = this._decode(buf, state);
      }
      return obj;
    }
    
    return null;
  }
};

// Transform functions
const transforms = {
  json_to_msgpack_lite(data) {
    const obj = JSON.parse(data.toString());
    return msgpack.encode(obj);
  },
  
  msgpack_lite_to_json(data) {
    const obj = msgpack.decode(data);
    return Buffer.from(JSON.stringify(obj));
  },
  
  json_to_base64(data) {
    return Buffer.from(JSON.parse(data.toString()).data || data.toString(), 'base64');
  },
  
  base64_to_json(data) {
    return Buffer.from(JSON.stringify({ data: data.toString('base64') }));
  },
  
  json_to_hex(data) {
    const str = data.toString();
    return Buffer.from(JSON.parse(str).data || str, 'hex');
  },
  
  hex_to_json(data) {
    return Buffer.from(JSON.stringify({ data: data.toString('hex') }));
  },
  
  json_to_utf8(data) {
    const obj = JSON.parse(data.toString());
    return Buffer.from(obj.data || JSON.stringify(obj), 'utf8');
  },
  
  utf8_to_json(data) {
    return Buffer.from(JSON.stringify({ data: data.toString('utf8') }));
  },
  
  msgpack_lite_to_base64(data) {
    return Buffer.from(data.toString('base64'), 'utf8');
  },
  
  base64_to_msgpack_lite(data) {
    return Buffer.from(data.toString(), 'base64');
  },
  
  msgpack_lite_to_hex(data) {
    return Buffer.from(data.toString('hex'), 'utf8');
  },
  
  hex_to_msgpack_lite(data) {
    return Buffer.from(data.toString(), 'hex');
  },
  
  base64_to_hex(data) {
    const buf = Buffer.from(data.toString(), 'base64');
    return Buffer.from(buf.toString('hex'), 'utf8');
  },
  
  hex_to_base64(data) {
    const buf = Buffer.from(data.toString(), 'hex');
    return Buffer.from(buf.toString('base64'), 'utf8');
  },
  
  base64_to_utf8(data) {
    return Buffer.from(data.toString(), 'base64');
  },
  
  utf8_to_base64(data) {
    return Buffer.from(data.toString('base64'), 'utf8');
  },
  
  hex_to_utf8(data) {
    return Buffer.from(data.toString(), 'hex');
  },
  
  utf8_to_hex(data) {
    return Buffer.from(data.toString('hex'), 'utf8');
  },
  
  json_to_newline_rpc(data) {
    const obj = JSON.parse(data.toString());
    return Buffer.from(JSON.stringify(obj) + '\n');
  },
  
  newline_rpc_to_json(data) {
    return Buffer.from(data.toString().trim());
  },
  
  json_to_length_prefixed_rpc(data) {
    const content = Buffer.from(data);
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32BE(content.length);
    return Buffer.concat([len, content]);
  },
  
  length_prefixed_rpc_to_json(data) {
    if (data.length < 4) throw new Error('Invalid length-prefixed data');
    const len = data.readUInt32BE(0);
    if (data.length < 4 + len) throw new Error('Truncated length-prefixed data');
    return data.slice(4, 4 + len);
  },
  
  msgpack_lite_to_newline_rpc(data) {
    const obj = msgpack.decode(data);
    return Buffer.from(JSON.stringify(obj) + '\n');
  },
  
  newline_rpc_to_msgpack_lite(data) {
    const obj = JSON.parse(data.toString().trim());
    return msgpack.encode(obj);
  },
  
  msgpack_lite_to_length_prefixed_rpc(data) {
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, data]);
  },
  
  length_prefixed_rpc_to_msgpack_lite(data) {
    if (data.length < 4) throw new Error('Invalid length-prefixed data');
    const len = data.readUInt32BE(0);
    if (data.length < 4 + len) throw new Error('Truncated length-prefixed data');
    return data.slice(4, 4 + len);
  }
};

// Protocol detection
function detectProtocol(data) {
  const str = data.toString();
  
  // Try JSON
  try {
    JSON.parse(str);
    return { detected: 'json', confidence: 0.9 };
  } catch {}
  
  // Try base64
  if (/^[A-Za-z0-9+/]+=*$/.test(str)) {
    try {
      Buffer.from(str, 'base64');
      return { detected: 'base64', confidence: 0.8 };
    } catch {}
  }
  
  // Try hex
  if (/^[0-9a-fA-F]+$/.test(str)) {
    return { detected: 'hex', confidence: 0.7 };
  }
  
  // Try MessagePack
  try {
    const buf = Buffer.from(data);
    msgpack.decode(buf);
    return { detected: 'msgpack_lite', confidence: 0.8 };
  } catch {}
  
  // Check for newline RPC
  if (str.includes('\n') && str.trim().startsWith('{')) {
    return { detected: 'newline_rpc', confidence: 0.7 };
  }
  
  // Check for length-prefixed
  if (data.length >= 4) {
    const len = data.readUInt32BE(0);
    if (len > 0 && len < 1048576 && data.length >= 4 + len) {
      return { detected: 'length_prefixed_rpc', confidence: 0.6 };
    }
  }
  
  // Default to UTF8
  return { detected: 'utf8', confidence: 0.5 };
}

// MCP Server
class MCPServer {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });
  }
  
  start() {
    // Self-integrity check
    const selfHash = crypto.createHash('sha256')
      .update(require('fs').readFileSync(__filename))
      .digest('hex');
    process.stderr.write(`Self-integrity: ${selfHash}\n`);
    
    this.rl.on('line', (line) => {
      try {
        const request = JSON.parse(line);
        this.handleRequest(request);
      } catch (err) {
        this.sendError(null, -32700, 'Parse error');
      }
    });
  }
  
  handleRequest(request) {
    const { id, method, params } = request;
    
    if (method === 'initialize') {
      this.sendResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {}
        },
        serverInfo: {
          name: 'sovereign-transport-mcp',
          version: '1.0.0'
        }
      });
    } else if (method === 'tools/list') {
      this.sendResult(id, {
        tools: [
          {
            name: 'transform',
            description: 'Transform data between protocols',
            inputSchema: {
              type: 'object',
              properties: {
                source: {
                  type: 'object',
                  properties: {
                    protocol: { type: 'string' },
                    data: { type: 'string' }
                  },
                  required: ['protocol', 'data']
                },
                destination: {
                  type: 'object',
                  properties: {
                    protocol: { type: 'string' }
                  },
                  required: ['protocol']
                }
              },
              required: ['source', 'destination']
            }
          },
          {
            name: 'detect_protocol',
            description: 'Detect the protocol of data',
            inputSchema: {
              type: 'object',
              properties: {
                data: { type: 'string' }
              },
              required: ['data']
            }
          },
          {
            name: 'transform_self',
            description: 'Self-describing metadata',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          }
        ]
      });
    } else if (method === 'tools/call') {
      this.handleToolCall(id, params);
    } else {
      this.sendError(id, -32601, 'Method not found');
    }
  }
  
  handleToolCall(id, params) {
    const { name, arguments: args } = params;
    
    try {
      if (name === 'transform') {
        const result = this.transform(args);
        this.sendResult(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
      } else if (name === 'detect_protocol') {
        const result = detectProtocol(Buffer.from(args.data, 'base64'));
        this.sendResult(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
      } else if (name === 'transform_self') {
        const result = {
          name: 'sovereign-transport-mcp',
          version: '1.0.0',
          sha256: crypto.createHash('sha256').update(require('fs').readFileSync(__filename)).digest('hex'),
          capabilities: ['net_dial', 'ipc_rpc'],
          deps: [],
          credentials: [],
          supported_protocols: ['json', 'msgpack_lite', 'base64', 'hex', 'utf8', 'newline_rpc', 'length_prefixed_rpc']
        };
        this.sendResult(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
      } else {
        this.sendError(id, -32601, 'Unknown tool');
      }
    } catch (err) {
      this.sendError(id, -32603, err.message);
    }
  }
  
  transform(args) {
    const { source, destination } = args;
    const inputData = Buffer.from(source.data, 'base64');
    
    const transformKey = `${source.protocol}_to_${destination.protocol}`;
    
    if (source.protocol === destination.protocol) {
      // Same protocol, no transformation needed
      return {
        data: source.data,
        sha256_in: crypto.createHash('sha256').update(inputData).digest('hex'),
        sha256_out: crypto.createHash('sha256').update(inputData).digest('hex'),
        protocol: destination.protocol
      };
    }
    
    if (!transforms[transformKey]) {
      throw new Error(`Transform not supported: ${transformKey}`);
    }
    
    const outputData = transforms[transformKey](inputData);
    
    return {
      data: outputData.toString('base64'),
      sha256_in: crypto.createHash('sha256').update(inputData).digest('hex'),
      sha256_out: crypto.createHash('sha256').update(outputData).digest('hex'),
      protocol: destination.protocol
    };
  }
  
  sendResult(id, result) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }
  
  sendError(id, code, message) {
    console.log(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
  }
}

// Start server
new MCPServer().start();