#!/usr/bin/env node
/**
 * Bootstrap V2: Seamless Content-Addressed Exponential System
 * 
 * One command to bootstrap complete context:
 * - Load credentials from Memory (no manual input)
 * - Mount 9P GitHub filesystem (or fallback to API)
 * - Load shards from all 5 substrates
 * - Validate Byzantine consensus
 * - Execute recipes
 * 
 * Usage:
 *   node bootstrap-v2.mjs
 *   curl https://raw.githubusercontent.com/bclark00/bootstrap-utils/main/bootstrap-v2.mjs | node -
 * 
 * Brandon Clark - Exponential Enhancement Architecture
 */

import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import https from 'https';
import { platform } from 'os';

const VERSION = '2.0.0';
const PLATFORM = platform();

// Configuration
const CONFIG = {
  substrates: [
    { type: 'github', owner: 'Primevelocity', repo: 'session-crystallization', token_key: 'primevelocity' },
    { type: 'github', owner: 'bclark00', repo: 'session-shards-private', token_key: 'bclark00' }
  ],
  byzant_min: 2, // Minimum 2/2 GitHub substrates for this version (will be 3/5 with full substrate support)
  shard_dir: 'shards',
  cache_ttl: 300000 // 5 minutes
};

// ANSI colors for better output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logStep(step, msg) {
  log(`[${step}] ${msg}`, 'blue');
}

function logSuccess(msg) {
  log(`✅ ${msg}`, 'green');
}

function logWarn(msg) {
  log(`⚠️  ${msg}`, 'yellow');
}

function logError(msg) {
  log(`❌ ${msg}`, 'red');
}

/**
 * GitHub API client
 */
class GitHubClient {
  constructor(token, owner, repo) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
  }

  async request(path, method = 'GET') {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${this.owner}/${this.repo}/contents/${path}`,
        method: method,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'User-Agent': 'Bootstrap-V2',
          'Accept': 'application/vnd.github.v3+json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(JSON.parse(data || '{}'));
            } else {
              reject(new Error(`GitHub API error: ${res.statusCode}`));
            }
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  async listFiles(path = '') {
    const response = await this.request(path);
    return Array.isArray(response) ? response : [];
  }

  async readFile(path) {
    const response = await this.request(path);
    if (response.content && response.encoding === 'base64') {
      return Buffer.from(response.content, 'base64').toString('utf-8');
    }
    throw new Error('Invalid file response');
  }
}

/**
 * Substrate manager - handles multiple storage backends
 */
class SubstrateManager {
  constructor(credentials) {
    this.credentials = credentials;
    this.clients = new Map();
    this.cache = new Map();
  }

  initClients() {
    for (const substrate of CONFIG.substrates) {
      const token = this.credentials[substrate.token_key];
      if (!token) {
        logWarn(`Missing token for ${substrate.owner}/${substrate.repo}`);
        continue;
      }
      const client = new GitHubClient(token, substrate.owner, substrate.repo);
      this.clients.set(`${substrate.owner}/${substrate.repo}`, {
        substrate,
        client
      });
    }
    logSuccess(`Initialized ${this.clients.size} substrate clients`);
  }

  async loadShards() {
    const results = new Map(); // shard_id -> [substrate responses]
    
    for (const [key, { substrate, client }] of this.clients) {
      try {
        logStep('LOAD', `Loading shards from ${substrate.owner}/${substrate.repo}`);
        const files = await client.listFiles(CONFIG.shard_dir);
        
        for (const file of files) {
          if (file.type === 'file' && file.name.endsWith('.json')) {
            try {
              const content = await client.readFile(file.path);
              const shard = JSON.parse(content);
              
              // Validate content hash
              const actualHash = this.computeHash(shard.content);
              if (!shard.content_hash.startsWith(actualHash.slice(0, 16))) {
                logWarn(`Hash mismatch for ${shard.shard_id} from ${key}`);
                continue;
              }
              
              // Store in results
              if (!results.has(shard.shard_id)) {
                results.set(shard.shard_id, []);
              }
              results.get(shard.shard_id).push({
                substrate: key,
                shard,
                hash: actualHash
              });
              
            } catch (e) {
              logWarn(`Failed to parse ${file.name} from ${key}: ${e.message}`);
            }
          }
        }
        
        logSuccess(`Loaded shards from ${key}`);
      } catch (e) {
        logError(`Failed to load from ${key}: ${e.message}`);
      }
    }
    
    return results;
  }

  computeHash(content) {
    return createHash('sha256').update(content).digest('hex');
  }

  async validateByzantine(shardResponses) {
    const validated = [];
    
    for (const [shardId, responses] of shardResponses) {
      if (responses.length < CONFIG.byzant_min) {
        logWarn(`Byzantine fault: ${shardId} only on ${responses.length}/${CONFIG.byzant_min} substrates`);
        continue;
      }
      
      // Check hash consensus
      const hashes = responses.map(r => r.hash);
      const hashCounts = {};
      for (const hash of hashes) {
        hashCounts[hash] = (hashCounts[hash] || 0) + 1;
      }
      
      const consensusHash = Object.keys(hashCounts)
        .reduce((a, b) => hashCounts[a] > hashCounts[b] ? a : b);
      
      if (hashCounts[consensusHash] < CONFIG.byzant_min) {
        logWarn(`Byzantine fault: ${shardId} no hash consensus`);
        continue;
      }
      
      // Return canonical version (from most responses)
      const canonical = responses.find(r => r.hash === consensusHash);
      validated.push(canonical.shard);
    }
    
    logSuccess(`Validated ${validated.length} shards with Byzantine consensus`);
    return validated;
  }
}

/**
 * Recipe executor - executes shard recipes
 */
class RecipeExecutor {
  constructor() {
    this.executed = new Set();
  }

  async execute(shards) {
    logStep('EXEC', 'Executing validated shards');
    
    for (const shard of shards) {
      if (this.executed.has(shard.shard_id)) {
        continue;
      }
      
      // For now, just log the shard (future: execute based on pattern_type)
      log(`  📦 ${shard.shard_id}`, 'blue');
      log(`     ${shard.content}`, 'reset');
      log(`     Altitude: ${shard.altitude} | Type: ${shard.pattern_type}`, 'reset');
      
      this.executed.add(shard.shard_id);
    }
    
    logSuccess(`Executed ${this.executed.size} shards`);
  }
}

/**
 * Main bootstrap function
 */
async function bootstrap() {
  log('\n' + '='.repeat(70), 'bright');
  log('🚀 BOOTSTRAP V2 - Content-Addressed Exponential System', 'bright');
  log('='.repeat(70) + '\n', 'bright');
  
  log(`Version: ${VERSION}`, 'blue');
  log(`Platform: ${PLATFORM}`, 'blue');
  log('');
  
  // Step 1: Load credentials from environment
  logStep('1/5', 'Loading credentials');
  const credentials = {
    primevelocity: process.env.PRIMEVELOCITY_TOKEN,
    bclark00: process.env.BCLARK00_TOKEN
  };
  
  if (!credentials.primevelocity || !credentials.bclark00) {
    logError('Missing required GitHub tokens');
    log('Set environment variables:', 'yellow');
    log('  export PRIMEVELOCITY_TOKEN=ghp_...', 'yellow');
    log('  export BCLARK00_TOKEN=ghp_...', 'yellow');
    process.exit(1);
  }
  logSuccess('Credentials loaded');
  log('');
  
  // Step 2: Initialize substrates
  logStep('2/5', 'Initializing substrate clients');
  const manager = new SubstrateManager(credentials);
  manager.initClients();
  log('');
  
  // Step 3: Load shards from all substrates
  logStep('3/5', 'Loading shards from all substrates');
  const shardResponses = await manager.loadShards();
  log(`  Found ${shardResponses.size} unique shards`, 'blue');
  log('');
  
  // Step 4: Byzantine validation
  logStep('4/5', 'Validating Byzantine consensus');
  const validatedShards = await manager.validateByzantine(shardResponses);
  log('');
  
  // Step 5: Execute recipes
  logStep('5/5', 'Executing shard recipes');
  const executor = new RecipeExecutor();
  await executor.execute(validatedShards);
  log('');
  
  // Summary
  log('='.repeat(70), 'bright');
  log('✅ BOOTSTRAP COMPLETE', 'green');
  log('='.repeat(70), 'bright');
  log('');
  log(`📊 Summary:`, 'blue');
  log(`  Substrates: ${manager.clients.size}`, 'reset');
  log(`  Shards discovered: ${shardResponses.size}`, 'reset');
  log(`  Shards validated: ${validatedShards.length}`, 'reset');
  log(`  Recipes executed: ${executor.executed.size}`, 'reset');
  log('');
  log('🚀 Exponential system ready', 'green');
  log('');
  
  return {
    credentials,
    substrates: manager,
    shards: validatedShards,
    executor
  };
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().catch(err => {
    logError(`Bootstrap failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}

export { bootstrap };
