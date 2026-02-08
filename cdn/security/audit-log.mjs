/**
 * CAP-SEC-001: Audit Logging Capability
 * 
 * Provides tamper-evident, append-only audit logging for 9P operations.
 * 
 * Features:
 * - Cryptographic hashing (SHA-256)
 * - Replay detection
 * - Integrity verification
 * - Query interface
 * 
 * Dependencies: None
 * Exports: AuditLog
 */

import { createHash } from 'crypto';
import { appendFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';

export class AuditLog {
  constructor(logPath = 'audit.log') {
    this.logPath = logPath;
    this.entries = [];
    this.hashChain = null; // Previous entry hash for chain
    this.seenHashes = new Set(); // For replay detection
  }

  /**
   * Initialize audit log (load existing entries)
   */
  async initialize() {
    if (this.logPath && typeof this.logPath === 'string' && existsSync(this.logPath)) {
      const content = await readFile(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l);
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          this.entries.push(entry);
          this.seenHashes.add(entry.hash);
          this.hashChain = entry.hash;
        } catch (e) {
          console.error('Failed to parse audit entry:', e);
        }
      }
    }
  }

  /**
   * Append operation to audit log
   * 
   * @param {string} operation - Operation type (e.g., 'Twrite', 'Topen')
   * @param {object} data - Operation data
   * @returns {object} Entry with hash
   */
  async append(operation, data) {
    const entry = {
      timestamp: Date.now(),
      sequence: this.entries.length,
      operation,
      data,
      previousHash: this.hashChain
    };

    // Compute hash including previous hash (chain)
    const entryJson = JSON.stringify({
      timestamp: entry.timestamp,
      sequence: entry.sequence,
      operation: entry.operation,
      data: entry.data,
      previousHash: entry.previousHash
    });

    entry.hash = createHash('sha256').update(entryJson).digest('hex');

    // Check for replay (duplicate hash)
    if (this.seenHashes.has(entry.hash)) {
      throw new Error(`Replay detected: ${entry.hash}`);
    }

    // Append to log file (atomic)
    if (this.logPath && typeof this.logPath === 'string') {
      await appendFile(this.logPath, JSON.stringify(entry) + '\n');
    }

    // Update in-memory state
    this.entries.push(entry);
    this.seenHashes.add(entry.hash);
    this.hashChain = entry.hash;

    return entry;
  }

  /**
   * Verify hash chain integrity
   * 
   * @returns {object} Verification result
   */
  verifyIntegrity() {
    let previousHash = null;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      // Check sequence number
      if (entry.sequence !== i) {
        return {
          valid: false,
          error: `Sequence mismatch at index ${i}`,
          entry
        };
      }

      // Check previous hash link
      if (entry.previousHash !== previousHash) {
        return {
          valid: false,
          error: `Hash chain broken at index ${i}`,
          entry
        };
      }

      // Recompute hash
      const entryJson = JSON.stringify({
        timestamp: entry.timestamp,
        sequence: entry.sequence,
        operation: entry.operation,
        data: entry.data,
        previousHash: entry.previousHash
      });

      const computedHash = createHash('sha256').update(entryJson).digest('hex');

      if (computedHash !== entry.hash) {
        return {
          valid: false,
          error: `Hash mismatch at index ${i}`,
          entry,
          expected: computedHash,
          actual: entry.hash
        };
      }

      previousHash = entry.hash;
    }

    return {
      valid: true,
      entries: this.entries.length,
      finalHash: previousHash
    };
  }

  /**
   * Query audit log
   * 
   * @param {object} filter - Filter criteria
   * @returns {Array} Matching entries
   */
  query(filter = {}) {
    return this.entries.filter(entry => {
      if (filter.operation && entry.operation !== filter.operation) {
        return false;
      }
      if (filter.after && entry.timestamp < filter.after) {
        return false;
      }
      if (filter.before && entry.timestamp > filter.before) {
        return false;
      }
      if (filter.path && entry.data.path !== filter.path) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get integrity proof (for external verification)
   * 
   * @returns {object} Proof package
   */
  getIntegrityProof() {
    return {
      totalEntries: this.entries.length,
      firstEntry: this.entries[0],
      lastEntry: this.entries[this.entries.length - 1],
      finalHash: this.hashChain,
      verification: this.verifyIntegrity()
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    const operations = {};
    
    for (const entry of this.entries) {
      operations[entry.operation] = (operations[entry.operation] || 0) + 1;
    }

    return {
      totalEntries: this.entries.length,
      uniqueHashes: this.seenHashes.size,
      operations,
      firstTimestamp: this.entries[0]?.timestamp,
      lastTimestamp: this.entries[this.entries.length - 1]?.timestamp
    };
  }
}

// Capability manifest
export const manifest = {
  id: 'CAP-SEC-001',
  name: 'audit-log',
  version: '1.0.0',
  description: 'Tamper-evident audit logging with hash chaining',
  provides: [
    'tamper-evident-logging',
    'operation-replay-detection',
    'hash-chain-verification',
    'audit-trail'
  ],
  requires: [],
  exports: ['AuditLog']
};
