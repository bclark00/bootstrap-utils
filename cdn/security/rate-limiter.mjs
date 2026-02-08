/**
 * CAP-SEC-002: Rate Limiting Capability
 * 
 * Provides per-client rate limiting and DoS protection.
 * 
 * Features:
 * - Token bucket algorithm
 * - Per-client tracking
 * - Configurable windows
 * - Burst handling
 * - Statistics
 * 
 * Dependencies: None
 * Exports: RateLimiter
 */

export class RateLimiter {
  constructor(options = {}) {
    this.maxRequests = options.maxRequests || 100;
    this.windowMs = options.windowMs || 1000;
    this.burstSize = options.burstSize || this.maxRequests * 1.2;
    
    // Client tracking: Map<clientId, ClientState>
    this.clients = new Map();
    
    // Statistics
    this.stats = {
      totalRequests: 0,
      totalRejections: 0,
      clientsTracked: 0
    };
    
    // Cleanup old clients periodically
    this.cleanupInterval = setInterval(
      () => this.cleanup(),
      this.windowMs * 10
    );
  }

  /**
   * Check if client should be rate limited
   * 
   * @param {string} clientId - Unique client identifier
   * @returns {boolean} True if allowed, false if rate limited
   */
  check(clientId) {
    this.stats.totalRequests++;
    
    const now = Date.now();
    let client = this.clients.get(clientId);
    
    if (!client) {
      // New client
      client = {
        tokens: this.maxRequests,
        lastRefill: now,
        totalRequests: 0,
        rejections: 0,
        firstSeen: now,
        lastSeen: now
      };
      this.clients.set(clientId, client);
      this.stats.clientsTracked++;
    }
    
    // Update last seen
    client.lastSeen = now;
    
    // Refill tokens based on elapsed time
    const elapsed = now - client.lastRefill;
    if (elapsed >= this.windowMs) {
      const windows = Math.floor(elapsed / this.windowMs);
      client.tokens = Math.min(
        this.burstSize,
        client.tokens + (windows * this.maxRequests)
      );
      client.lastRefill = now;
    }
    
    // Check if request allowed
    if (client.tokens >= 1) {
      client.tokens -= 1;
      client.totalRequests++;
      return true;
    } else {
      client.rejections++;
      this.stats.totalRejections++;
      return false;
    }
  }

  /**
   * Reset rate limit for a client
   * 
   * @param {string} clientId - Client to reset
   */
  reset(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      client.tokens = this.maxRequests;
      client.lastRefill = Date.now();
    }
  }

  /**
   * Get statistics for a client
   * 
   * @param {string} clientId - Client to query
   * @returns {object} Client statistics
   */
  getClientStats(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return null;
    
    return {
      totalRequests: client.totalRequests,
      rejections: client.rejections,
      currentTokens: client.tokens,
      firstSeen: client.firstSeen,
      lastSeen: client.lastSeen,
      rejectionRate: client.rejections / client.totalRequests
    };
  }

  /**
   * Get global statistics
   * 
   * @returns {object} Overall statistics
   */
  getStats() {
    return {
      ...this.stats,
      averageRequestsPerClient: this.stats.totalRequests / this.stats.clientsTracked,
      globalRejectionRate: this.stats.totalRejections / this.stats.totalRequests
    };
  }

  /**
   * Get top clients by request count
   * 
   * @param {number} limit - Number of clients to return
   * @returns {Array} Top clients
   */
  getTopClients(limit = 10) {
    const clients = Array.from(this.clients.entries()).map(([id, client]) => ({
      clientId: id,
      ...client
    }));
    
    return clients
      .sort((a, b) => b.totalRequests - a.totalRequests)
      .slice(0, limit);
  }

  /**
   * Cleanup inactive clients
   */
  cleanup() {
    const now = Date.now();
    const maxAge = this.windowMs * 60; // 60 windows of inactivity
    
    for (const [clientId, client] of this.clients.entries()) {
      if (now - client.lastSeen > maxAge) {
        this.clients.delete(clientId);
        this.stats.clientsTracked--;
      }
    }
  }

  /**
   * Destroy rate limiter (cleanup)
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Capability manifest
export const manifest = {
  id: 'CAP-SEC-002',
  name: 'rate-limiter',
  version: '1.0.0',
  description: 'Per-client rate limiting with token bucket algorithm',
  provides: [
    'dos-protection',
    'request-throttling',
    'burst-handling',
    'client-tracking'
  ],
  requires: [],
  exports: ['RateLimiter'],
  config: {
    maxRequests: {
      type: 'number',
      default: 100,
      description: 'Maximum requests per window'
    },
    windowMs: {
      type: 'number',
      default: 1000,
      description: 'Time window in milliseconds'
    },
    burstSize: {
      type: 'number',
      description: 'Maximum burst size (defaults to maxRequests * 1.2)'
    }
  }
};
