const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const VERSION = '1.0.0';

function computeSHA256(filePath) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function log(message) {
  process.stderr.write(`${message}\n`);
}

function verify(manifestPath) {
  log(`SOVEREIGN-BOOT v${VERSION}`);
  
  const manifestData = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestData);
  
  if (!manifest.version || !manifest.components || !Array.isArray(manifest.components)) {
    log('[HALT] Invalid manifest format');
    process.exit(1);
  }
  
  const manifestDir = path.dirname(manifestPath);
  
  for (const component of manifest.components) {
    const filePath = path.join(manifestDir, component.file);
    
    try {
      const actualHash = computeSHA256(filePath);
      
      if (actualHash !== component.sha256) {
        log(`[HALT] Hash mismatch for ${component.file}`);
        log(`  Expected: ${component.sha256}`);
        log(`  Actual:   ${actualHash}`);
        process.exit(1);
      }
      
      log(`[VERIFY] ${component.file.padEnd(27)} sha256:${actualHash.substring(0, 8)}... OK`);
    } catch (err) {
      log(`[HALT] Cannot read ${component.file}: ${err.message}`);
      process.exit(1);
    }
  }
  
  return { manifest, manifestDir };
}

function startComponents(manifest, manifestDir) {
  const layers = {};
  const processes = new Map();
  const restartCounts = new Map();
  
  for (const component of manifest.components) {
    if (!layers[component.layer]) {
      layers[component.layer] = [];
    }
    layers[component.layer].push(component);
  }
  
  const layerNumbers = Object.keys(layers).map(n => parseInt(n)).sort((a, b) => a - b);
  
  function spawnComponent(component) {
    const filePath = path.join(manifestDir, component.file);
    const env = { ...process.env };
    
    if (process.env.SOVEREIGN_FS_ROOT) env.SOVEREIGN_FS_ROOT = process.env.SOVEREIGN_FS_ROOT;
    if (process.env.SOVEREIGN_PIPES) env.SOVEREIGN_PIPES = process.env.SOVEREIGN_PIPES;
    
    const proc = spawn('node', [filePath], { env });
    
    log(`[START]  layer-${component.layer} ${component.file} PID=${proc.pid}`);
    
    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        log(`[layer-${component.layer}] ${line}`);
      }
    });
    
    proc.on('exit', (code, signal) => {
      const key = `${component.layer}-${component.file}`;
      const restarts = restartCounts.get(key) || 0;
      
      log(`[EXIT] layer-${component.layer} ${component.file} code=${code} signal=${signal} restarts=${restarts}`);
      
      if (restarts < 3) {
        restartCounts.set(key, restarts + 1);
        log(`[RESTART] Attempting restart ${restarts + 1}/3 for ${component.file}`);
        setTimeout(() => spawnComponent(component), 1000);
      } else {
        log(`[HALT] Max restarts exceeded for ${component.file}`);
        process.exit(1);
      }
    });
    
    processes.set(`${component.layer}-${component.file}`, proc);
  }
  
  for (const layerNum of layerNumbers) {
    for (const component of layers[layerNum]) {
      spawnComponent(component);
    }
  }
}

if (require.main === module) {
  const manifestPath = process.env.SOVEREIGN_MANIFEST || 
                      path.join(path.dirname(process.argv[1]), 'sovereign-manifest.json');
  
  const { manifest, manifestDir } = verify(manifestPath);
  startComponents(manifest, manifestDir);
  
  process.on('SIGINT', () => {
    log('[SHUTDOWN] Received SIGINT');
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    log('[SHUTDOWN] Received SIGTERM');
    process.exit(0);
  });
}

module.exports = { verify };