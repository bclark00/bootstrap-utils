/**
 * CAP-CDN-001: Sovereign CDN Node
 * 
 * Individual node in the sovereign CDN mesh.
 * Caches STCS content and participates in DHT.
 * 
 * Features:
 * - LRU content cache
 * - Peer discovery via UDP broadcast
 * - DHT participant (consistent hashing)
 * - GitHub fallback
 * - HTTP server
 * 
 * Dependencies: CAP-STORE-001 (GitHub backing)
 */

import { createServer } from 'http';
import { createHash } from 'crypto';
import dgram from 'dgram';

/**
 * Simple LRU Cache Implementation
 */
class LRUCache {
  constructor(maxSize = 500, maxBytes = 100 * 1024 * 1024) {
    this.maxSize = maxSize;
    this.maxBytes = maxBytes;
    this.cache = new Map(); // key → { value, size, timestamp }
    this.currentBytes = 0;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    return entry.value;
  }

  set(key, value) {
    const size = Buffer.byteLength(value);

    // Remove old entry if exists
    if (this.cache.has(key)) {
      const old = this.cache.get(key);
      this.currentBytes -= old.size;
      this.cache.delete(key);
    }

    // Evict if necessary
    while (
      (this.cache.size >= this.maxSize || this.currentBytes + size > this.maxBytes) &&
      this.cache.size > 0
    ) {
      const firstKey = this.cache.keys().next().value;
      const entry = this.cache.get(firstKey);
      this.currentBytes -= entry.size;
      this.cache.delete(firstKey);
    }

    // Add new entry
    this.cache.set(key, {
      value,
      size,
      timestamp: Date.now()
    });
    this.currentBytes += size;
  }

  has(key) {
    return this.cache.has(key);
  }

  get size() {
    return this.cache.size;
  }

  get bytes() {
    return this.currentBytes;
  }

  clear() {
    this.cache.clear();
    this.currentBytes = 0;
  }
}

/**
 * Sovereign CDN Node
 */
export class SovereignCDNNode {
  constructor(config = {}) {
    // Node identity
    this.nodeId = config.nodeId || this.generateNodeId();
    this.nodeName = config.nodeName || `node-${this.nodeId.substring(0, 8)}`;
    this.port = config.port || 5650;
    this.discoveryPort = config.discoveryPort || 5651;
    
    // Content cache
    this.cache = new LRUCache(
      config.cacheSize || 500,
      config.maxCacheBytes || 100 * 1024 * 1024
    );
    
    // Peer registry: nodeId → peer info
    this.peers = new Map();
    
    // DHT: contentHash → [nodeId1, nodeId2, nodeId3]
    this.dht = new Map();
    
    // GitHub backing
    this.githubBacking = config.githubBacking;
    
    // Statistics
    this.stats = {
      requests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      bytesServed: 0,
      peerRequests: 0,
      peerHits: 0,
      githubFallbacks: 0,
      startTime: Date.now()
    };
    
    // Server instances
    this.server = null;
    this.discoverySocket = null;
    this.announceInterval = null;
  }

  /**
   * Start CDN node
   */
  async start() {
    console.log(`\n=== Starting Sovereign CDN Node ===`);
    console.log(`Node ID: ${this.nodeId}`);
    console.log(`Name: ${this.nodeName}`);
    console.log(`HTTP Port: ${this.port}`);
    console.log(`Discovery Port: ${this.discoveryPort}\n`);

    // Start HTTP server
    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(this.port);
    console.log(`[HTTP] Server listening on port ${this.port}`);

    // Start UDP peer discovery
    this.discoverySocket = dgram.createSocket('udp4');
    this.discoverySocket.on('message', (msg, rinfo) => this.handlePeerMessage(msg, rinfo));
    this.discoverySocket.bind(this.discoveryPort);
    console.log(`[Discovery] Listening on port ${this.discoveryPort}`);

    // Announce presence periodically
    this.announceInterval = setInterval(() => this.announcePeer(), 30000);
    await this.announcePeer();

    // Sync from GitHub if available
    if (this.githubBacking) {
      console.log(`\n[Sync] Starting GitHub sync...`);
      await this.syncFromGitHub();
    } else {
      console.log(`\n[Warning] No GitHub backing configured - cache-only mode`);
    }

    console.log(`\n[Ready] CDN Node ${this.nodeName} is operational!\n`);
  }

  /**
   * Handle HTTP request
   */
  async handleRequest(req, res) {
    this.stats.requests++;
    const path = req.url;

    // Special endpoints
    if (path === '/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.getStats(), null, 2));
      return;
    }

    if (path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', nodeId: this.nodeId }));
      return;
    }

    if (path === '/peers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.getPeerInfo(), null, 2));
      return;
    }

    // Content request
    console.log(`[Request] ${path}`);

    // Step 1: Try local cache
    const cached = this.cache.get(path);
    if (cached) {
      this.stats.cacheHits++;
      this.stats.bytesServed += cached.length;
      console.log(`[Cache HIT] ${path} (${cached.length} bytes)`);
      
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'X-CDN-Node': this.nodeId,
        'X-CDN-Source': 'cache'
      });
      res.end(cached);
      return;
    }

    this.stats.cacheMisses++;
    console.log(`[Cache MISS] ${path}`);

    // Step 2: Check DHT for peer nodes
    const contentHash = this.hashPath(path);
    const nodes = this.dht.get(contentHash);

    if (nodes && nodes.length > 0) {
      console.log(`[DHT] Found ${nodes.length} nodes with content`);
      
      for (const nodeId of nodes) {
        if (nodeId === this.nodeId) continue; // Skip self

        const content = await this.fetchFromPeer(nodeId, path);
        if (content) {
          this.stats.peerHits++;
          
          // Cache locally
          this.cache.set(path, content);
          this.stats.bytesServed += content.length;
          
          console.log(`[Peer HIT] ${path} from node ${nodeId.substring(0, 8)}`);
          
          res.writeHead(200, { 
            'Content-Type': 'application/json',
            'X-CDN-Node': this.nodeId,
            'X-CDN-Source': 'peer',
            'X-CDN-Peer': nodeId
          });
          res.end(content);
          return;
        }
      }
    }

    // Step 3: Fallback to GitHub
    if (!this.githubBacking) {
      console.log(`[Error] No GitHub backing - content not found`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found (no backing store)');
      return;
    }

    try {
      this.stats.githubFallbacks++;
      console.log(`[GitHub] Fetching from backing store...`);
      
      const content = await this.githubBacking.read(path);

      // Cache locally
      this.cache.set(path, content);

      // Update DHT
      this.updateDHT(contentHash, this.nodeId);

      this.stats.bytesServed += content.length;
      console.log(`[GitHub] Success (${content.length} bytes, cached)`);

      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'X-CDN-Node': this.nodeId,
        'X-CDN-Source': 'github'
      });
      res.end(content);
    } catch (e) {
      console.error(`[Error] ${path}: ${e.message}`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  }

  /**
   * Announce peer presence via UDP broadcast
   */
  async announcePeer() {
    const announcement = JSON.stringify({
      type: 'peer_announce',
      nodeId: this.nodeId,
      nodeName: this.nodeName,
      port: this.port,
      timestamp: Date.now(),
      cacheSize: this.cache.size,
      cacheBytes: this.cache.bytes,
      stats: {
        requests: this.stats.requests,
        cacheHits: this.stats.cacheHits,
        uptime: Date.now() - this.stats.startTime
      }
    });

    try {
      // Broadcast to local subnet
      this.discoverySocket.send(announcement, this.discoveryPort, '255.255.255.255');
      
      // Also send to n2n subnet if configured
      // TODO: Get n2n subnet broadcast address
    } catch (e) {
      // Broadcast may fail, that's ok
    }
  }

  /**
   * Handle peer discovery message
   */
  handlePeerMessage(msg, rinfo) {
    try {
      const data = JSON.parse(msg.toString());

      if (data.type === 'peer_announce' && data.nodeId !== this.nodeId) {
        const isNew = !this.peers.has(data.nodeId);
        
        // Register peer
        this.peers.set(data.nodeId, {
          nodeId: data.nodeId,
          nodeName: data.nodeName || 'unknown',
          address: rinfo.address,
          port: data.port,
          lastSeen: Date.now(),
          cacheSize: data.cacheSize || 0,
          cacheBytes: data.cacheBytes || 0,
          stats: data.stats || {}
        });

        if (isNew) {
          console.log(`[Discovery] New peer: ${data.nodeName} (${data.nodeId.substring(0, 8)}) at ${rinfo.address}:${data.port}`);
        }
      }
    } catch (e) {
      // Invalid message, ignore
    }
  }

  /**
   * Fetch content from peer node
   */
  async fetchFromPeer(nodeId, path) {
    const peer = this.peers.get(nodeId);
    if (!peer) return null;

    this.stats.peerRequests++;

    try {
      const url = `http://${peer.address}:${peer.port}${path}`;
      const response = await fetch(url, { timeout: 5000 });
      
      if (response.ok) {
        return await response.text();
      }
    } catch (e) {
      console.log(`[Peer Error] Failed to fetch from ${peer.nodeName}: ${e.message}`);
    }

    return null;
  }

  /**
   * Sync from GitHub (cold start)
   */
  async syncFromGitHub() {
    if (!this.githubBacking) return;

    try {
      // For now, we'll sync on-demand rather than pre-loading
      // This keeps startup fast
      console.log(`[Sync] GitHub backing ready - will sync on demand`);
    } catch (e) {
      console.error(`[Sync Error] ${e.message}`);
    }
  }

  /**
   * Update DHT with content location
   */
  updateDHT(contentHash, nodeId) {
    if (!this.dht.has(contentHash)) {
      this.dht.set(contentHash, []);
    }

    const nodes = this.dht.get(contentHash);
    if (!nodes.includes(nodeId)) {
      nodes.push(nodeId);

      // Limit replication factor to 3
      if (nodes.length > 3) {
        nodes.shift();
      }
    }
  }

  /**
   * Generate node ID from system info
   */
  generateNodeId() {
    const data = `${process.platform}-${process.arch}-${Date.now()}-${Math.random()}`;
    return createHash('sha256').update(data).digest('hex').substring(0, 32);
  }

  /**
   * Hash path for DHT lookup
   */
  hashPath(path) {
    return createHash('sha256').update(path).digest('hex');
  }

  /**
   * Get node statistics
   */
  getStats() {
    const uptime = Date.now() - this.stats.startTime;
    const hitRate = this.stats.requests > 0 
      ? (this.stats.cacheHits / this.stats.requests * 100).toFixed(1)
      : 0;

    return {
      node: {
        id: this.nodeId,
        name: this.nodeName,
        uptime: Math.floor(uptime / 1000) + 's'
      },
      cache: {
        size: this.cache.size,
        bytes: this.cache.bytes,
        maxSize: this.cache.maxSize,
        maxBytes: this.cache.maxBytes,
        utilization: (this.cache.bytes / this.cache.maxBytes * 100).toFixed(1) + '%'
      },
      stats: {
        ...this.stats,
        hitRate: hitRate + '%',
        requestsPerSecond: (this.stats.requests / (uptime / 1000)).toFixed(2)
      },
      peers: {
        count: this.peers.size,
        nodes: Array.from(this.peers.values()).map(p => ({
          name: p.nodeName,
          id: p.nodeId.substring(0, 8),
          address: p.address
        }))
      },
      dht: {
        entries: this.dht.size
      }
    };
  }

  /**
   * Get peer information
   */
  getPeerInfo() {
    return Array.from(this.peers.values()).map(peer => ({
      nodeId: peer.nodeId,
      nodeName: peer.nodeName,
      address: peer.address,
      port: peer.port,
      lastSeen: peer.lastSeen,
      cacheSize: peer.cacheSize,
      cacheBytes: peer.cacheBytes
    }));
  }

  /**
   * Shutdown node
   */
  async shutdown() {
    console.log(`\n[Shutdown] Stopping CDN node...`);
    
    if (this.announceInterval) {
      clearInterval(this.announceInterval);
    }
    
    if (this.server) {
      this.server.close();
    }
    
    if (this.discoverySocket) {
      this.discoverySocket.close();
    }

    console.log(`[Shutdown] Complete`);
  }
}

// Capability manifest
export const manifest = {
  id: 'CAP-CDN-001',
  name: 'sovereign-cdn-node',
  version: '1.0.0',
  description: 'Sovereign CDN node with DHT and peer discovery',
  provides: [
    'content-caching',
    'peer-discovery',
    'dht-participant',
    'github-fallback',
    'http-server'
  ],
  requires: ['CAP-STORE-001'], // Optional - works without
  exports: ['SovereignCDNNode'],
  config: {
    nodeId: { 
      type: 'string', 
      description: 'Unique node identifier (auto-generated if not provided)' 
    },
    nodeName: { 
      type: 'string', 
      description: 'Human-readable node name' 
    },
    port: { 
      type: 'number', 
      default: 5650,
      description: 'HTTP server port'
    },
    discoveryPort: { 
      type: 'number', 
      default: 5651,
      description: 'UDP discovery port'
    },
    cacheSize: { 
      type: 'number', 
      default: 500,
      description: 'Maximum number of cached items'
    },
    maxCacheBytes: { 
      type: 'number', 
      default: 100 * 1024 * 1024,
      description: 'Maximum cache size in bytes (default 100MB)'
    },
    githubBacking: {
      type: 'object',
      description: 'CAP-STORE-001 instance for GitHub backing (optional)'
    }
  }
};
