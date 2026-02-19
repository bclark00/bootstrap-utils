const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 9P2000 message types
const Tversion = 100, Rversion = 101;
const Tattach = 104, Rattach = 105;
const Twalk = 110, Rwalk = 111;
const Topen = 112, Ropen = 113;
const Tread = 116, Rread = 117;
const Tstat = 124, Rstat = 125;
const Tclunk = 120, Rclunk = 121;
const Tflush = 108, Rflush = 109;

// 9P2000 constants
const NOTAG = 0xFFFF;
const NOFID = 0xFFFFFFFF;
const VERSION = "9P2000";
const MAXWELEM = 16;

// Qid types
const QTDIR = 0x80;
const QTFILE = 0x00;

// Open modes
const OREAD = 0;

// Error strings
const Enoent = "file not found";
const Eperm = "permission denied";
const Ebadfid = "bad fid";
const Ebaddir = "bad directory";

// Configuration
const SOVEREIGN_9P_PORT = parseInt(process.env.SOVEREIGN_9P_PORT || 5640);
const SOVEREIGN_9P_HOST = process.env.SOVEREIGN_9P_HOST || '0.0.0.0';
const SOVEREIGN_FS_ROOT = process.env.SOVEREIGN_FS_ROOT || process.cwd();

// Gateway info
const GATEWAY_INFO_NAME = '.sovereign-gateway-info';
const GATEWAY_VERSION = '1.0.0';

class Buffer9P {
    constructor(size) {
        this.buf = Buffer.alloc(size);
        this.pos = 0;
    }

    static from(buf) {
        const b = new Buffer9P(0);
        b.buf = buf;
        b.pos = 0;
        return b;
    }

    writeU8(v) {
        this.buf.writeUInt8(v, this.pos);
        this.pos += 1;
    }

    writeU16(v) {
        this.buf.writeUInt16LE(v, this.pos);
        this.pos += 2;
    }

    writeU32(v) {
        this.buf.writeUInt32LE(v, this.pos);
        this.pos += 4;
    }

    writeU64(v) {
        this.buf.writeBigUInt64LE(BigInt(v), this.pos);
        this.pos += 8;
    }

    writeString(s) {
        const len = Buffer.byteLength(s);
        this.writeU16(len);
        this.buf.write(s, this.pos, len);
        this.pos += len;
    }

    writeBytes(b) {
        b.copy(this.buf, this.pos);
        this.pos += b.length;
    }

    readU8() {
        const v = this.buf.readUInt8(this.pos);
        this.pos += 1;
        return v;
    }

    readU16() {
        const v = this.buf.readUInt16LE(this.pos);
        this.pos += 2;
        return v;
    }

    readU32() {
        const v = this.buf.readUInt32LE(this.pos);
        this.pos += 4;
        return v;
    }

    readU64() {
        const v = this.buf.readBigUInt64LE(this.pos);
        this.pos += 8;
        return Number(v);
    }

    readString() {
        const len = this.readU16();
        const s = this.buf.toString('utf8', this.pos, this.pos + len);
        this.pos += len;
        return s;
    }

    readBytes(n) {
        const b = this.buf.slice(this.pos, this.pos + n);
        this.pos += n;
        return b;
    }

    remaining() {
        return this.buf.length - this.pos;
    }

    slice() {
        return this.buf.slice(0, this.pos);
    }
}

class Qid {
    constructor(type, vers, path) {
        this.type = type;
        this.vers = vers;
        this.path = path;
    }

    write(buf) {
        buf.writeU8(this.type);
        buf.writeU32(this.vers);
        buf.writeU64(this.path);
    }

    static read(buf) {
        const type = buf.readU8();
        const vers = buf.readU32();
        const path = buf.readU64();
        return new Qid(type, vers, path);
    }
}

class Stat {
    constructor() {
        this.type = 0;
        this.dev = 0;
        this.qid = new Qid(0, 0, 0);
        this.mode = 0;
        this.atime = 0;
        this.mtime = 0;
        this.length = 0;
        this.name = '';
        this.uid = 'nobody';
        this.gid = 'nobody';
        this.muid = 'nobody';
    }

    write(buf) {
        const tmp = new Buffer9P(512);
        tmp.writeU16(this.type);
        tmp.writeU32(this.dev);
        this.qid.write(tmp);
        tmp.writeU32(this.mode);
        tmp.writeU32(this.atime);
        tmp.writeU32(this.mtime);
        tmp.writeU64(this.length);
        tmp.writeString(this.name);
        tmp.writeString(this.uid);
        tmp.writeString(this.gid);
        tmp.writeString(this.muid);
        
        const statData = tmp.slice();
        buf.writeU16(statData.length);
        buf.writeBytes(statData);
    }

    static read(buf) {
        const stat = new Stat();
        const size = buf.readU16();
        const start = buf.pos;
        
        stat.type = buf.readU16();
        stat.dev = buf.readU32();
        stat.qid = Qid.read(buf);
        stat.mode = buf.readU32();
        stat.atime = buf.readU32();
        stat.mtime = buf.readU32();
        stat.length = buf.readU64();
        stat.name = buf.readString();
        stat.uid = buf.readString();
        stat.gid = buf.readString();
        stat.muid = buf.readString();
        
        return stat;
    }
}

class Fid {
    constructor(fid) {
        this.fid = fid;
        this.path = null;
        this.qid = null;
        this.isOpen = false;
    }
}

class Connection {
    constructor(socket, server) {
        this.socket = socket;
        this.server = server;
        this.fids = new Map();
        this.msize = 8192;
        this.buffer = Buffer.alloc(0);
        
        console.error(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`);
        
        socket.on('data', (data) => this.onData(data));
        socket.on('error', (err) => this.onError(err));
        socket.on('close', () => this.onClose());
    }

    onData(data) {
        this.buffer = Buffer.concat([this.buffer, data]);
        
        while (this.buffer.length >= 4) {
            const size = this.buffer.readUInt32LE(0);
            if (this.buffer.length < size) break;
            
            const msg = this.buffer.slice(0, size);
            this.buffer = this.buffer.slice(size);
            
            this.handleMessage(msg);
        }
    }

    onError(err) {
        console.error(`Connection error: ${err}`);
    }

    onClose() {
        console.error(`Client disconnected`);
        this.fids.clear();
    }

    handleMessage(msg) {
        const buf = Buffer9P.from(msg);
        const size = buf.readU32();
        const type = buf.readU8();
        const tag = buf.readU16();
        
        try {
            switch (type) {
                case Tversion:
                    this.handleTversion(buf, tag);
                    break;
                case Tattach:
                    this.handleTattach(buf, tag);
                    break;
                case Twalk:
                    this.handleTwalk(buf, tag);
                    break;
                case Topen:
                    this.handleTopen(buf, tag);
                    break;
                case Tread:
                    this.handleTread(buf, tag);
                    break;
                case Tstat:
                    this.handleTstat(buf, tag);
                    break;
                case Tclunk:
                    this.handleTclunk(buf, tag);
                    break;
                case Tflush:
                    this.handleTflush(buf, tag);
                    break;
                default:
                    this.sendError(tag, "unknown message type");
            }
        } catch (err) {
            this.sendError(tag, err.message);
        }
    }

    sendError(tag, err) {
        const msg = Buffer.alloc(128);
        const buf = Buffer9P.from(msg);
        buf.writeU32(0); // placeholder
        buf.writeU8(107); // Rerror
        buf.writeU16(tag);
        buf.writeString(err);
        
        const size = buf.pos;
        msg.writeUInt32LE(size, 0);
        this.socket.write(msg.slice(0, size));
    }

    sendReply(type, tag, writeFn) {
        const msg = Buffer.alloc(this.msize);
        const buf = Buffer9P.from(msg);
        buf.writeU32(0); // placeholder
        buf.writeU8(type);
        buf.writeU16(tag);
        
        writeFn(buf);
        
        const size = buf.pos;
        msg.writeUInt32LE(size, 0);
        this.socket.write(msg.slice(0, size));
    }

    handleTversion(buf, tag) {
        const msize = buf.readU32();
        const version = buf.readString();
        
        if (!version.startsWith("9P2000")) {
            this.sendError(tag, "unknown version");
            return;
        }
        
        this.msize = Math.min(msize, 65536);
        
        this.sendReply(Rversion, tag, (buf) => {
            buf.writeU32(this.msize);
            buf.writeString(VERSION);
        });
    }

    handleTattach(buf, tag) {
        const fid = buf.readU32();
        const afid = buf.readU32();
        const uname = buf.readString();
        const aname = buf.readString();
        
        if (this.fids.has(fid)) {
            this.sendError(tag, "fid in use");
            return;
        }
        
        const f = new Fid(fid);
        f.path = '/';
        f.qid = this.pathToQid(f.path);
        this.fids.set(fid, f);
        
        this.sendReply(Rattach, tag, (buf) => {
            f.qid.write(buf);
        });
    }

    handleTwalk(buf, tag) {
        const fid = buf.readU32();
        const newfid = buf.readU32();
        const nwname = buf.readU16();
        
        const names = [];
        for (let i = 0; i < nwname; i++) {
            names.push(buf.readString());
        }
        
        const f = this.fids.get(fid);
        if (!f) {
            this.sendError(tag, Ebadfid);
            return;
        }
        
        let currentPath = f.path;
        const qids = [];
        
        for (const name of names) {
            if (name === '..') {
                currentPath = path.dirname(currentPath);
            } else {
                currentPath = path.join(currentPath, name);
            }
            
            const realPath = this.virtualToReal(currentPath);
            if (!realPath || !this.pathExists(realPath)) {
                break;
            }
            
            qids.push(this.pathToQid(currentPath));
        }
        
        if (qids.length < names.length && names.length > 0) {
            this.sendError(tag, Enoent);
            return;
        }
        
        if (newfid !== fid) {
            const nf = new Fid(newfid);
            nf.path = currentPath;
            nf.qid = qids.length > 0 ? qids[qids.length - 1] : f.qid;
            this.fids.set(newfid, nf);
        } else {
            f.path = currentPath;
            f.qid = qids.length > 0 ? qids[qids.length - 1] : f.qid;
        }
        
        this.sendReply(Rwalk, tag, (buf) => {
            buf.writeU16(qids.length);
            for (const qid of qids) {
                qid.write(buf);
            }
        });
    }

    handleTopen(buf, tag) {
        const fid = buf.readU32();
        const mode = buf.readU8();
        
        if (mode !== OREAD) {
            this.sendError(tag, Eperm);
            return;
        }
        
        const f = this.fids.get(fid);
        if (!f) {
            this.sendError(tag, Ebadfid);
            return;
        }
        
        f.isOpen = true;
        
        this.sendReply(Ropen, tag, (buf) => {
            f.qid.write(buf);
            buf.writeU32(this.msize - 24);
        });
    }

    handleTread(buf, tag) {
        const fid = buf.readU32();
        const offset = buf.readU64();
        const count = buf.readU32();
        
        const f = this.fids.get(fid);
        if (!f || !f.isOpen) {
            this.sendError(tag, Ebadfid);
            return;
        }
        
        const realPath = this.virtualToReal(f.path);
        let data;
        
        if (f.path === '/' + GATEWAY_INFO_NAME) {
            data = this.getGatewayInfo();
        } else if (!realPath) {
            this.sendError(tag, Enoent);
            return;
        } else {
            const stats = fs.statSync(realPath);
            
            if (stats.isDirectory()) {
                data = this.readDir(realPath);
            } else {
                const content = fs.readFileSync(realPath);
                const hash = crypto.createHash('sha256').update(content).digest('hex');
                console.error(`Read: ${f.path} sha256:${hash}`);
                data = content;
            }
        }
        
        const slice = data.slice(offset, offset + count);
        
        this.sendReply(Rread, tag, (buf) => {
            buf.writeU32(slice.length);
            buf.writeBytes(slice);
        });
    }

    handleTstat(buf, tag) {
        const fid = buf.readU32();
        
        const f = this.fids.get(fid);
        if (!f) {
            this.sendError(tag, Ebadfid);
            return;
        }
        
        const stat = this.getStat(f.path);
        if (!stat) {
            this.sendError(tag, Enoent);
            return;
        }
        
        this.sendReply(Rstat, tag, (buf) => {
            buf.writeU16(0); // dummy size
            const start = buf.pos;
            stat.write(buf);
            const statSize = buf.pos - start;
            buf.buf.writeUInt16LE(statSize - 2, start - 2);
        });
    }

    handleTclunk(buf, tag) {
        const fid = buf.readU32();
        
        this.fids.delete(fid);
        
        this.sendReply(Rclunk, tag, (buf) => {});
    }

    handleTflush(buf, tag) {
        const oldtag = buf.readU16();
        this.sendReply(Rflush, tag, (buf) => {});
    }

    virtualToReal(vpath) {
        if (vpath === '/' + GATEWAY_INFO_NAME) {
            return null; // synthetic file
        }
        
        const normalized = path.normalize(vpath);
        if (normalized.startsWith('..')) {
            return null;
        }
        
        const realPath = path.join(SOVEREIGN_FS_ROOT, normalized.slice(1));
        if (!realPath.startsWith(SOVEREIGN_FS_ROOT)) {
            return null;
        }
        
        return realPath;
    }

    pathExists(realPath) {
        try {
            fs.accessSync(realPath);
            return true;
        } catch {
            return false;
        }
    }

    pathToQid(vpath) {
        let type = QTFILE;
        let vers = 0;
        let pathHash = 0;
        
        if (vpath === '/' + GATEWAY_INFO_NAME) {
            const content = this.getGatewayInfo();
            const hash = crypto.createHash('sha256').update(content).digest();
            vers = hash.readUInt32LE(0);
        } else {
            const realPath = this.virtualToReal(vpath);
            if (realPath && this.pathExists(realPath)) {
                const stats = fs.statSync(realPath);
                
                if (stats.isDirectory()) {
                    type = QTDIR;
                } else {
                    const content = fs.readFileSync(realPath);
                    const hash = crypto.createHash('sha256').update(content).digest();
                    vers = hash.readUInt32LE(0);
                }
            }
        }
        
        // Generate path id from hash of virtual path
        const pathBuf = Buffer.from(vpath, 'utf8');
        const pathHashBuf = crypto.createHash('sha256').update(pathBuf).digest();
        pathHash = pathHashBuf.readBigUInt64LE(0);
        
        return new Qid(type, vers, Number(pathHash & 0xFFFFFFFFFFFFFFFFn));
    }

    getStat(vpath) {
        const stat = new Stat();
        const basename = path.basename(vpath) || '/';
        
        if (vpath === '/' + GATEWAY_INFO_NAME) {
            const content = this.getGatewayInfo();
            const hash = crypto.createHash('sha256').update(content).digest('hex');
            
            stat.qid = this.pathToQid(vpath);
            stat.mode = 0o444;
            stat.atime = Math.floor(Date.now() / 1000);
            stat.mtime = stat.atime;
            stat.length = content.length;
            stat.name = basename + '|sha256:' + hash;
            
            return stat;
        }
        
        const realPath = this.virtualToReal(vpath);
        if (!realPath || !this.pathExists(realPath)) {
            return null;
        }
        
        const stats = fs.statSync(realPath);
        stat.qid = this.pathToQid(vpath);
        
        if (stats.isDirectory()) {
            stat.mode = 0o555 | 0x80000000;
            stat.name = basename;
        } else {
            stat.mode = 0o444;
            const content = fs.readFileSync(realPath);
            const hash = crypto.createHash('sha256').update(content).digest('hex');
            stat.name = basename + '|sha256:' + hash;
        }
        
        stat.atime = Math.floor(stats.atime.getTime() / 1000);
        stat.mtime = Math.floor(stats.mtime.getTime() / 1000);
        stat.length = stats.size;
        
        return stat;
    }

    readDir(realPath) {
        const entries = fs.readdirSync(realPath);
        const buf = new Buffer9P(65536);
        
        for (const entry of entries) {
            const vpath = '/' + path.relative(SOVEREIGN_FS_ROOT, path.join(realPath, entry)).replace(/\\/g, '/');
            const stat = this.getStat(vpath);
            if (stat) {
                stat.write(buf);
            }
        }
        
        // Add synthetic file to root
        if (realPath === SOVEREIGN_FS_ROOT) {
            const stat = this.getStat('/' + GATEWAY_INFO_NAME);
            if (stat) {
                stat.write(buf);
            }
        }
        
        return buf.slice();
    }

    getGatewayInfo() {
        const selfContent = fs.readFileSync(__filename);
        const selfHash = crypto.createHash('sha256').update(selfContent).digest('hex');
        
        const info = {
            version: GATEWAY_VERSION,
            sha256_of_self: selfHash,
            root: SOVEREIGN_FS_ROOT,
            read_only: true,
            port: SOVEREIGN_9P_PORT
        };
        
        return Buffer.from(JSON.stringify(info, null, 2));
    }
}

class Server9P {
    constructor() {
        this.server = net.createServer();
        this.connections = new Set();
        
        this.server.on('connection', (socket) => {
            const conn = new Connection(socket, this);
            this.connections.add(conn);
            
            socket.on('close', () => {
                this.connections.delete(conn);
            });
        });
    }

    listen() {
        this.server.listen(SOVEREIGN_9P_PORT, SOVEREIGN_9P_HOST, () => {
            console.error(`9P2000 server listening on ${SOVEREIGN_9P_HOST}:${SOVEREIGN_9P_PORT}`);
            console.error(`Exporting: ${SOVEREIGN_FS_ROOT}`);
        });
    }
}

// Start server
const server = new Server9P();
server.listen();