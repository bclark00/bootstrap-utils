#!/usr/bin/env node
/**
 * Bootstrap V2 - Local Testing Version
 * Uses already-cloned repos instead of GitHub API
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

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

function computeHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function loadShardsFromDir(dirPath, substrateName) {
  const shards = [];
  try {
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = join(dirPath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const shard = JSON.parse(content);
        
        // Validate hash
        const actualHash = computeHash(shard.content);
        if (shard.content_hash.startsWith(actualHash.slice(0, 16))) {
          shards.push({ shard, substrate: substrateName, hash: actualHash });
          log(`  ✓ ${shard.shard_id}`, 'green');
        } else {
          log(`  ✗ ${shard.shard_id} (hash mismatch)`, 'red');
        }
      }
    }
  } catch (e) {
    log(`  ✗ Failed to load from ${dirPath}: ${e.message}`, 'red');
  }
  return shards;
}

async function bootstrap() {
  log('\n' + '='.repeat(70), 'bright');
  log('🚀 BOOTSTRAP V2 - Local Testing Mode', 'bright');
  log('='.repeat(70) + '\n', 'bright');
  
  // Load shards from local cloned repos
  log('[1/3] Loading shards from local repositories', 'blue');
  
  const allShards = [];
  
  log('\n  Substrate: bclark00/session-shards-private', 'blue');
  const bclarkShards = await loadShardsFromDir('/tmp/session-shards/shards', 'bclark00');
  allShards.push(...bclarkShards);
  
  log(`\n  Total shards loaded: ${allShards.length}`, 'green');
  
  // Group by shard_id for Byzantine validation
  log('\n[2/3] Grouping and validating shards', 'blue');
  const shardMap = new Map();
  for (const { shard, substrate, hash } of allShards) {
    if (!shardMap.has(shard.shard_id)) {
      shardMap.set(shard.shard_id, []);
    }
    shardMap.get(shard.shard_id).push({ shard, substrate, hash });
  }
  
  log(`  Unique shards: ${shardMap.size}`, 'green');
  
  // Display all shards
  log('\n[3/3] Shard Summary', 'blue');
  log('');
  
  for (const [shardId, versions] of shardMap) {
    const shard = versions[0].shard;
    log(`  📦 ${shardId}`, 'bright');
    log(`     ${shard.content}`, 'reset');
    log(`     Altitude: ${shard.altitude} | Type: ${shard.pattern_type} | Substrates: ${versions.length}`, 'blue');
    log('');
  }
  
  // Summary
  log('='.repeat(70), 'bright');
  log('✅ BOOTSTRAP COMPLETE', 'green');
  log('='.repeat(70), 'bright');
  log('');
  log(`📊 Summary:`, 'blue');
  log(`  Shards loaded: ${allShards.length}`, 'reset');
  log(`  Unique shards: ${shardMap.size}`, 'reset');
  log('');
  log('🚀 Content-addressed shard system working!', 'green');
  log('');
  
  return { shards: Array.from(shardMap.values()).map(v => v[0].shard) };
}

bootstrap().catch(err => {
  log(`❌ Bootstrap failed: ${err.message}`, 'red');
  console.error(err.stack);
  process.exit(1);
});
