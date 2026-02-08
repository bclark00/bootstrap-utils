/**
 * Capability Loader with Dependency Graph
 * 
 * Loads and composes capabilities based on dependency graph.
 * Ensures all dependencies are satisfied before activation.
 */

import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class CapabilityLoader {
  constructor() {
    this.capabilities = new Map(); // Map<id, {manifest, module, instance}>
    this.graph = new DependencyGraph();
  }

  /**
   * Load all capabilities from directory structure
   */
  async discoverCapabilities() {
    const categories = ['security', 'protocol', 'storage', 'monitoring', 'stcs'];
    const discovered = [];

    for (const category of categories) {
      const categoryPath = join(__dirname, category);
      
      try {
        const files = await readdir(categoryPath);
        
        for (const file of files) {
          if (file.endsWith('.mjs') && file !== 'index.mjs') {
            const modulePath = join(categoryPath, file);
            const module = await import(`file://${modulePath}`);
            
            if (module.manifest) {
              discovered.push({
                category,
                file,
                path: modulePath,
                manifest: module.manifest,
                module
              });
            }
          }
        }
      } catch (e) {
        // Category doesn't exist yet, skip
      }
    }

    return discovered;
  }

  /**
   * Load capability by ID
   * 
   * @param {string} id - Capability ID (e.g., 'CAP-SEC-001')
   * @param {object} config - Capability configuration
   */
  async loadCapability(id, config = {}) {
    // Check if already loaded
    if (this.capabilities.has(id)) {
      return this.capabilities.get(id);
    }

    // Find capability in discovered list
    const discovered = await this.discoverCapabilities();
    const cap = discovered.find(c => c.manifest.id === id);

    if (!cap) {
      throw new Error(`Capability not found: ${id}`);
    }

    // Load dependencies first
    for (const depId of cap.manifest.requires || []) {
      if (depId.startsWith('CAP-')) {
        // It's another capability
        await this.loadCapability(depId);
      }
      // Otherwise it's an npm package (assumed available)
    }

    // Instantiate capability
    const exportName = cap.manifest.exports[0]; // Primary export
    const CapabilityClass = cap.module[exportName];
    const instance = new CapabilityClass(config);

    // Initialize if method exists
    if (instance.initialize) {
      await instance.initialize();
    }

    // Store loaded capability
    const loadedCap = {
      manifest: cap.manifest,
      module: cap.module,
      instance,
      config
    };

    this.capabilities.set(id, loadedCap);
    
    // Add to dependency graph
    this.graph.addNode(id, cap.manifest.requires || []);

    return loadedCap;
  }

  /**
   * Load capabilities from configuration
   * 
   * @param {object} config - Configuration object
   */
  async loadFromConfig(config) {
    const loaded = [];

    for (const capConfig of config.capabilities || []) {
      if (capConfig.enabled !== false) {
        const cap = await this.loadCapability(capConfig.id, capConfig.config);
        loaded.push(cap);
      }
    }

    // Verify dependency graph is valid
    const validation = this.graph.validate();
    if (!validation.valid) {
      throw new Error(`Dependency graph invalid: ${validation.error}`);
    }

    return loaded;
  }

  /**
   * Get loaded capability instance
   * 
   * @param {string} id - Capability ID
   * @returns {object} Capability instance or null
   */
  get(id) {
    const cap = this.capabilities.get(id);
    return cap ? cap.instance : null;
  }

  /**
   * Check if capability is loaded
   * 
   * @param {string} id - Capability ID
   * @returns {boolean}
   */
  has(id) {
    return this.capabilities.has(id);
  }

  /**
   * Get dependency graph visualization
   * 
   * @returns {object} Graph data
   */
  getGraph() {
    return this.graph.toJSON();
  }

  /**
   * Unload all capabilities
   */
  async unloadAll() {
    // Unload in reverse dependency order
    const order = this.graph.getTopologicalOrder().reverse();

    for (const id of order) {
      const cap = this.capabilities.get(id);
      if (cap && cap.instance.destroy) {
        await cap.instance.destroy();
      }
      this.capabilities.delete(id);
    }

    this.graph.clear();
  }
}

/**
 * Dependency Graph Implementation
 */
class DependencyGraph {
  constructor() {
    this.nodes = new Map(); // Map<id, {requires: [], requiredBy: []}>
  }

  /**
   * Add node to graph
   * 
   * @param {string} id - Node ID
   * @param {Array} requires - Dependencies
   */
  addNode(id, requires = []) {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { requires: [], requiredBy: [] });
    }

    const node = this.nodes.get(id);
    node.requires = requires.filter(r => r.startsWith('CAP-'));

    // Update reverse dependencies
    for (const depId of node.requires) {
      if (!this.nodes.has(depId)) {
        this.nodes.set(depId, { requires: [], requiredBy: [] });
      }
      const depNode = this.nodes.get(depId);
      if (!depNode.requiredBy.includes(id)) {
        depNode.requiredBy.push(id);
      }
    }
  }

  /**
   * Validate graph (check for cycles, missing deps)
   * 
   * @returns {object} Validation result
   */
  validate() {
    // Check for missing dependencies
    for (const [id, node] of this.nodes) {
      for (const depId of node.requires) {
        if (!this.nodes.has(depId)) {
          return {
            valid: false,
            error: `Missing dependency: ${id} requires ${depId}`
          };
        }
      }
    }

    // Check for cycles
    const cycle = this.detectCycle();
    if (cycle) {
      return {
        valid: false,
        error: `Dependency cycle detected: ${cycle.join(' -> ')}`
      };
    }

    return { valid: true };
  }

  /**
   * Detect cycles using DFS
   * 
   * @returns {Array|null} Cycle path or null
   */
  detectCycle() {
    const visited = new Set();
    const recursionStack = new Set();
    const path = [];

    const dfs = (nodeId) => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const node = this.nodes.get(nodeId);
      for (const depId of node.requires) {
        if (!visited.has(depId)) {
          const cycle = dfs(depId);
          if (cycle) return cycle;
        } else if (recursionStack.has(depId)) {
          // Cycle detected
          const cycleStart = path.indexOf(depId);
          return path.slice(cycleStart);
        }
      }

      recursionStack.delete(nodeId);
      path.pop();
      return null;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        const cycle = dfs(nodeId);
        if (cycle) return cycle;
      }
    }

    return null;
  }

  /**
   * Get topological order (dependencies before dependents)
   * 
   * @returns {Array} Sorted node IDs
   */
  getTopologicalOrder() {
    const visited = new Set();
    const order = [];

    const visit = (nodeId) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      for (const depId of node.requires) {
        visit(depId);
      }

      order.push(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      visit(nodeId);
    }

    return order;
  }

  /**
   * Export graph as JSON
   */
  toJSON() {
    const result = {};
    for (const [id, node] of this.nodes) {
      result[id] = {
        requires: node.requires,
        requiredBy: node.requiredBy
      };
    }
    return result;
  }

  /**
   * Clear graph
   */
  clear() {
    this.nodes.clear();
  }
}

// Export both classes
export { DependencyGraph };
