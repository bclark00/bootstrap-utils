#!/usr/bin/env node
/**
 * Sovereign CDN Node - Universal Deployment
 * 
 * Cross-platform deployment script for any machine.
 * Works on Windows, Linux, macOS.
 * 
 * Usage:
 *   export GITHUB_TOKEN="your_token_here"
 *   node deploy-cdn.mjs
 * 
 * Optional environment variables:
 *   NODE_NAME - Custom node name (default: auto-generated)
 *   CDN_PORT - HTTP port (default: 5650)
 *   CACHE_SIZE - Max items (default: 1000)
 *   CACHE_MB - Max cache in MB (default: 500)
 */

import { SovereignCDNNode } from './sovereign-node.mjs';
import { CapabilityLoader } from '../loader.mjs';
import { networkInterfaces, hostname } from 'os';

/**
 * Get local IP address
 */
function getLocalIP() {
  const nets = networkInterfaces();
  
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip internal and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  
  return 'localhost';
}

/**
 * Generate node name from hostname
 */
function generateNodeName() {
  if (process.env.NODE_NAME) {
    return process.env.NODE_NAME;
  }
  
  const host = hostname();
  const platform = process.platform;
  return `cdn-${platform}-${host}`;
}

async function deploy() {
  console.log('=== Sovereign CDN Node - Universal Deployment ===\n');
  
  // Configuration
  const nodeName = generateNodeName();
  const localIP = getLocalIP();
  const port = parseInt(process.env.CDN_PORT || '5650');
  const cacheSize = parseInt(process.env.CACHE_SIZE || '1000');
  const cacheMB = parseInt(process.env.CACHE_MB || '500');
  const githubToken = process.env.GITHUB_TOKEN;
  
  console.log(`Platform: ${process.platform}`);
  console.log(`Node Name: ${nodeName}`);
  console.log(`Local IP: ${localIP}`);
  console.log(`Port: ${port}`);
  console.log(`Cache: ${cacheSize} items, ${cacheMB}MB\n`);
  
  // Check GitHub token
  if (!githubToken) {
    console.log('⚠️  Warning: GITHUB_TOKEN not set');
    console.log('   Node will run in cache-only mode');
    console.log('   Set token: export GITHUB_TOKEN="ghp_..."');
    console.log('');
  }
  
  // Load capabilities
  const loader = new CapabilityLoader();
  let githubBacking = null;
  
  if (githubToken) {
    console.log('[Setup] Loading GitHub backing capability...');
    try {
      await loader.loadCapability('CAP-STORE-001', {
        owner: 'bclark00',
        repo: 'stcs-substrate',
        token: githubToken,
        branch: 'main'
      });
      githubBacking = loader.get('CAP-STORE-001');
      console.log('[Setup] ✓ GitHub backing loaded\n');
    } catch (e) {
      console.error('[Setup] Failed to load GitHub backing:', e.message);
      console.log('[Setup] Continuing in cache-only mode\n');
    }
  }
  
  // Create CDN node
  const node = new SovereignCDNNode({
    nodeName,
    port,
    discoveryPort: port + 1, // Discovery on next port
    cacheSize,
    maxCacheBytes: cacheMB * 1024 * 1024,
    githubBacking
  });
  
  // Start node
  await node.start();
  
  // Monitoring (every minute)
  setInterval(() => {
    const stats = node.getStats();
    const peers = stats.peers.count;
    const hitRate = stats.stats.hitRate;
    const cacheUsage = (stats.cache.bytes / 1024 / 1024).toFixed(2);
    
    console.log(`[Monitor] Requests: ${stats.stats.requests}, Hit Rate: ${hitRate}, Cache: ${stats.cache.size} items (${cacheUsage}MB), Peers: ${peers}`);
  }, 60000);
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n[Shutdown] Graceful shutdown initiated...');
    await node.shutdown();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n\n[Shutdown] Graceful shutdown initiated...');
    await node.shutdown();
    process.exit(0);
  });
  
  // Show endpoints
  console.log('\n=== CDN Node Operational ===');
  console.log(`\nEndpoints:`);
  console.log(`  http://${localIP}:${port}/health`);
  console.log(`  http://${localIP}:${port}/stats`);
  console.log(`  http://${localIP}:${port}/peers`);
  console.log(`  http://${localIP}:${port}/[path]`);
  console.log(`\nLocal:`);
  console.log(`  http://localhost:${port}/stats`);
  console.log(`\nPress Ctrl+C for graceful shutdown\n`);
}

// Run deployment
deploy().catch(console.error);
