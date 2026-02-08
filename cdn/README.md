# Sovereign CDN - Distributed Content Delivery

**Build your own CDN across your infrastructure. Zero vendor lock-in.**

## What is This?

A capability-based CDN system that runs on **your hardware**, using **your network**. No cloud providers, no monthly fees, complete sovereignty over your data.

### Features

- ✅ **Distributed Hash Table (DHT)** - Content-addressable storage
- ✅ **Peer Discovery** - Automatic node discovery via UDP broadcast
- ✅ **LRU Caching** - Intelligent cache eviction
- ✅ **GitHub Backing** - Canonical storage with version control
- ✅ **HTTP API** - Simple REST interface
- ✅ **Cross-Platform** - Windows, Linux, macOS
- ✅ **Zero Dependencies** - Just Node.js required

### Architecture

```
Client Request
    ↓
Local Cache? → YES → Serve (instant)
    ↓ NO
DHT Lookup → Peer has it? → Fetch from peer (fast)
    ↓ NO
GitHub Fallback → Cache → Serve
```

## Quick Start

### Prerequisites

- Node.js 18+ 
- GitHub token (optional, for backing store)

### Installation

```bash
# Clone this repo
git clone https://github.com/bclark00/bootstrap-utils.git
cd bootstrap-utils/cdn

# Install dependencies
npm install @octokit/rest

# Set GitHub token (optional)
export GITHUB_TOKEN="ghp_your_token_here"

# Deploy
node deploy-cdn.mjs
```

**That's it!** Your CDN node is running.

### Verify

```bash
# Health check
curl http://localhost:5650/health

# Get statistics
curl http://localhost:5650/stats

# Fetch content
curl http://localhost:5650/README.md
```

## Configuration

Set via environment variables:

```bash
export GITHUB_TOKEN="ghp_..."        # GitHub token (optional)
export NODE_NAME="my-cdn-node"       # Custom name (optional)
export CDN_PORT="5650"               # HTTP port (default: 5650)
export CACHE_SIZE="1000"             # Max cached items (default: 1000)
export CACHE_MB="500"                # Max cache MB (default: 500)

node deploy-cdn.mjs
```

## Multi-Node Setup

Deploy on multiple machines for distributed caching:

### Node 1 (Primary)
```bash
export NODE_NAME="cdn-primary"
export CACHE_MB="500"
node deploy-cdn.mjs
```

### Node 2 (Edge)
```bash
export NODE_NAME="cdn-edge-1"
export CACHE_MB="500"
node deploy-cdn.mjs
```

### Node 3 (Edge)
```bash
export NODE_NAME="cdn-edge-2"
export CACHE_MB="500"
node deploy-cdn.mjs
```

**Nodes automatically discover each other via UDP broadcast** (port 5651).

After ~30 seconds, check peers:
```bash
curl http://localhost:5650/peers
```

## API Endpoints

### `GET /health`
Health check
```json
{"status":"ok","nodeId":"abc123..."}
```

### `GET /stats`
Node statistics
```json
{
  "node": {"id":"...","name":"...","uptime":"123s"},
  "cache": {"size":45,"bytes":123456,"utilization":"2.3%"},
  "stats": {"requests":100,"hitRate":"85.0%"},
  "peers": {"count":2,"nodes":[...]},
  "dht": {"entries":50}
}
```

### `GET /peers`
Connected peers
```json
[
  {
    "nodeId": "abc123...",
    "nodeName": "cdn-edge-1",
    "address": "10.0.0.5",
    "port": 5650,
    "cacheSize": 42
  }
]
```

### `GET /{path}`
Fetch content
- Checks local cache
- Checks peer nodes (via DHT)
- Falls back to GitHub
- Caches result

## Run as Service

### Linux (systemd)

```bash
sudo tee /etc/systemd/system/cdn-node.service << EOF
[Unit]
Description=Sovereign CDN Node
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/cdn
Environment="GITHUB_TOKEN=ghp_..."
ExecStart=/usr/bin/node deploy-cdn.mjs
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable cdn-node
sudo systemctl start cdn-node
```

### macOS (launchd)

```bash
cat > ~/Library/LaunchAgents/com.exponential.cdn.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" 
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.exponential.cdn</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/cdn/deploy-cdn.mjs</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/cdn</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>GITHUB_TOKEN</key>
        <string>ghp_...</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.exponential.cdn.plist
```

### Windows (NSSM)

```powershell
# Download NSSM: https://nssm.cc/download
nssm install CDN-Node "C:\Program Files\nodejs\node.exe"
nssm set CDN-Node AppDirectory "C:\path\to\cdn"
nssm set CDN-Node AppParameters "deploy-cdn.mjs"
nssm set CDN-Node AppEnvironmentExtra "GITHUB_TOKEN=ghp_..."
nssm start CDN-Node
```

## GitHub Backing

CDN can use GitHub as canonical storage:

1. **Create private repo**: `github.com/youruser/cdn-data`
2. **Generate token**: Settings → Developer → Personal Access Token
3. **Edit `deploy-cdn.mjs`**: Change `owner` and `repo`
4. **Deploy**: Token enables read/write to GitHub

## Performance

### Single Node
- **Cache hits**: ~1ms response time
- **GitHub fallback**: ~200-500ms (network dependent)
- **Capacity**: 1000 items, 500MB default

### Multi-Node (3 nodes)
- **Cache hits**: ~1ms (local)
- **Peer hits**: ~10-50ms (LAN)
- **GitHub fallback**: ~200-500ms
- **Total capacity**: 3000 items, 1.5GB
- **Hit rate**: ~85%+ after warm-up

## Monitoring

```bash
# Real-time stats
watch -n 5 'curl -s http://localhost:5650/stats'

# Multi-node monitoring script
cat > monitor-cdn.sh << 'EOF'
#!/bin/bash
for node in "10.0.0.5:5650" "10.0.0.6:5650" "10.0.0.7:5650"; do
  echo "=== $node ==="
  curl -s http://$node/stats | jq '.node.name,.stats.hitRate,.cache.size'
  echo ""
done
EOF

chmod +x monitor-cdn.sh
./monitor-cdn.sh
```

## Troubleshooting

### Peers not discovering?

**Check firewall** (UDP port 5651):
```bash
# Linux
sudo ufw allow 5651/udp

# macOS
# Firewall typically allows outbound UDP

# Windows
netsh advfirewall firewall add rule name="CDN Discovery" dir=in action=allow protocol=UDP localport=5651
```

**Test manually**:
```bash
# On Node 1
nc -u -l 5651

# On Node 2
echo "test" | nc -u <node1-ip> 5651
```

### High memory usage?

Reduce cache:
```bash
export CACHE_MB="100"  # 100MB instead of 500MB
node deploy-cdn.mjs
```

### GitHub rate limits?

Use authenticated requests (token) for 5000 req/hour vs 60 req/hour.

## Architecture Details

### Capability System

CDN is built using composable capabilities:

- **CAP-CDN-001**: CDN node (caching, DHT, peers)
- **CAP-STORE-001**: GitHub backing
- **CAP-SEC-001**: Audit logging (optional)
- **CAP-SEC-002**: Rate limiting (optional)

### DHT (Distributed Hash Table)

Content is mapped to nodes using SHA-256:
```
hash(path) → [node1, node2, node3]
```

Replication factor: 3 (configurable)

### Peer Discovery

UDP broadcast on port 5651:
```json
{
  "type": "peer_announce",
  "nodeId": "abc123...",
  "nodeName": "cdn-primary",
  "port": 5650,
  "cacheSize": 42
}
```

Broadcast every 30 seconds.

## Use Cases

### Personal CDN
- Serve files across home lab
- Distributed backup
- Local development assets

### Small Team CDN
- Shared file cache
- Development resources
- Build artifacts

### IoT Edge CDN
- Edge device coordination
- Firmware distribution
- Configuration sync

### Research/Learning
- Distributed systems concepts
- DHT implementation
- P2P networking

## Comparison

| Feature | Sovereign CDN | Cloudflare | AWS CloudFront |
|---------|--------------|------------|----------------|
| **Cost** | $0 | $1-5/mo | $20-100/mo |
| **Control** | 100% | Limited | Limited |
| **Privacy** | Complete | Shared infra | Shared infra |
| **Latency** | Sub-10ms (LAN) | 50-100ms | 50-100ms |
| **Setup** | 5 minutes | 10 minutes | 1+ hour |
| **Learning** | Maximum | Minimal | Minimal |

## Roadmap

- [x] Basic CDN node (CAP-CDN-001)
- [x] Peer discovery
- [x] DHT implementation
- [x] GitHub backing
- [ ] Intelligent routing (latency-based)
- [ ] Content prefetching
- [ ] Edge compute
- [ ] Web UI dashboard
- [ ] Prometheus metrics

## Contributing

This is experimental infrastructure. Use at your own risk. Contributions welcome!

## License

MIT

## Credits

Part of the **Exponential Infrastructure** project.

Built by Brandon Clark ([bclark00@gmail.com](mailto:bclark00@gmail.com))

---

**Build sovereign infrastructure. Own your stack.** 🚀
