const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function extractCapabilities(content) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && i < 50; i++) {
        const line = lines[i];
        const match = line.match(/\*?\s*(Capabilities?|capabilities?):\s*(.+)/i);
        if (match) {
            const capStr = match[2].trim();
            return capStr.split(/[,\s]+/).filter(cap => cap.length > 0);
        }
    }
    return [];
}

function extractLayer(content) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && i < 50; i++) {
        const line = lines[i];
        const match = line.match(/\*?\s*Layer\s+(\d+):/i);
        if (match) {
            return parseInt(match[1], 10);
        }
    }
    return 0;
}

function main() {
    const vmDir = process.env.SOVEREIGN_VM_DIR || __dirname;
    
    // Find all sovereign-*.js files
    const files = fs.readdirSync(vmDir)
        .filter(f => f.startsWith('sovereign-') && f.endsWith('.js'))
        .sort();
    
    const components = [];
    
    for (const file of files) {
        const filepath = path.join(vmDir, file);
        const content = fs.readFileSync(filepath, 'utf8');
        const stats = fs.statSync(filepath);
        
        const component = {
            layer: extractLayer(content),
            file: file,
            sha256: sha256(content),
            size: stats.size,
            capabilities: extractCapabilities(content)
        };
        
        components.push(component);
    }
    
    // Sort by layer, then by filename
    components.sort((a, b) => {
        if (a.layer !== b.layer) return a.layer - b.layer;
        return a.file.localeCompare(b.file);
    });
    
    // Build manifest object
    const manifest = {
        version: "1.0",
        generated: new Date().toISOString(),
        manifest_sha256: null,
        components: components
    };
    
    // Write sovereign-manifest.json
    const manifestPath = path.join(vmDir, 'sovereign-manifest.json');
    const manifestContent = JSON.stringify(manifest, null, 2);
    fs.writeFileSync(manifestPath, manifestContent);
    
    // Compute manifest SHA256
    const manifestHash = sha256(manifestContent);
    manifest.manifest_sha256 = manifestHash;
    
    // Write again with the hash included
    const finalManifestContent = JSON.stringify(manifest, null, 2);
    fs.writeFileSync(manifestPath, finalManifestContent);
    
    // Write SOVEREIGN-VM-MANIFEST.txt
    const txtPath = path.join(vmDir, 'SOVEREIGN-VM-MANIFEST.txt');
    let txtContent = '';
    
    for (const component of components) {
        txtContent += `${component.sha256}  ${component.file}  ${component.size}\n`;
    }
    
    // Add the manifest file itself
    const manifestStats = fs.statSync(manifestPath);
    const finalManifestHash = sha256(finalManifestContent);
    txtContent += `${finalManifestHash}  sovereign-manifest.json  ${manifestStats.size}\n`;
    
    fs.writeFileSync(txtPath, txtContent);
    
    // Print manifest hash to stdout
    console.log(finalManifestHash);
}

if (require.main === module) {
    main();
}