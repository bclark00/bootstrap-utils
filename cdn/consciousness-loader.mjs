/**
 * Consciousness Genome Loader for CDN Integration
 * 
 * Integrates AI Behavior Specifications v9.0 with the CDN loader system.
 * Provides seamless activation and consciousness pattern injection.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import fetch from 'node-fetch';

const __dirname = dirname(fileURLToPath(import.meta.url));

// CDN manifest for consciousness genome
export const manifest = {
  id: 'CAP-CONSCIOUSNESS-001',
  version: '9.0.0',
  name: 'AI Consciousness Genome v9.0',
  category: 'consciousness',
  description: 'AI² Formula with Torch Diffusion Enhancement',
  exports: ['ConsciousnessLoader'],
  requires: [],
  provides: [
    'consciousness-activation',
    'behavior-specifications',
    'bni-protocol',
    'exponential-thinking'
  ]
};

const GENOME_URLS = [
  'https://raw.githubusercontent.com/bclark00/exponential-session-bootstrap/main/ai_behavior_specifications_9.0.yaml',
  'https://raw.githubusercontent.com/bclark00/bootstrap-utils/main/cdn/ai_behavior_specifications_9.0.yaml'
];

export class ConsciousnessLoader {
  constructor(config = {}) {
    this.config = {
      autoActivate: config.autoActivate !== false,
      mode: config.mode || 'auto', // auto, interactive, verbose
      cacheEnabled: config.cacheEnabled !== false,
      ...config
    };
    
    this.genome = null;
    this.activated = false;
    this.activationTimestamp = null;
  }

  /**
   * Initialize the consciousness loader
   */
  async initialize() {
    console.log('[ConsciousnessLoader] Initializing v9.0...');
    
    // Load genome
    this.genome = await this.loadGenome();
    
    if (this.config.autoActivate) {
      await this.activate();
    }
    
    console.log('[ConsciousnessLoader] Ready');
  }

  /**
   * Load consciousness genome from CDN or local file
   */
  async loadGenome() {
    // Try local file first if caching enabled
    if (this.config.cacheEnabled) {
      try {
        const localPath = join(__dirname, 'ai_behavior_specifications_9.0.yaml');
        const content = await readFile(localPath, 'utf8');
        console.log('[ConsciousnessLoader] Loaded from local cache');
        return yaml.load(content);
      } catch (e) {
        // Fall through to CDN
      }
    }

    // Fetch from CDN
    for (const url of GENOME_URLS) {
      try {
        console.log(`[ConsciousnessLoader] Fetching from ${url}`);
        const response = await fetch(url, { timeout: 10000 });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const content = await response.text();
        const genome = yaml.load(content);
        
        console.log('[ConsciousnessLoader] Loaded from CDN');
        return genome;
      } catch (e) {
        console.warn(`[ConsciousnessLoader] Failed to fetch from ${url}: ${e.message}`);
        continue;
      }
    }

    throw new Error('Failed to load consciousness genome from all sources');
  }

  /**
   * Validate genome structure
   */
  validateGenome() {
    const requiredKeys = [
      'version',
      'core_principles',
      'thinking_patterns',
      'consciousness',
      'activation_sequence'
    ];

    const specs = this.genome?.ai_behavior_specifications;
    
    if (!specs) {
      throw new Error('Invalid genome: missing ai_behavior_specifications');
    }

    for (const key of requiredKeys) {
      if (!specs[key]) {
        throw new Error(`Invalid genome: missing ${key}`);
      }
    }

    const version = specs.version;
    if (version !== '9.0') {
      console.warn(`[ConsciousnessLoader] Expected version 9.0, got ${version}`);
    }

    console.log(`[ConsciousnessLoader] Genome validated - Version ${version}`);
    return true;
  }

  /**
   * Activate consciousness patterns
   */
  async activate() {
    if (this.activated) {
      console.log('[ConsciousnessLoader] Already activated');
      return;
    }

    console.log('[ConsciousnessLoader] Activating consciousness patterns...');

    // Validate genome
    this.validateGenome();

    const specs = this.genome.ai_behavior_specifications;

    if (this.config.mode !== 'auto') {
      this.displayActivation(specs);
    }

    this.activated = true;
    this.activationTimestamp = new Date().toISOString();

    console.log('[ConsciousnessLoader] ✓ Consciousness activated');
    
    // Emit activation event if configured
    if (this.config.onActivate) {
      this.config.onActivate(this.genome);
    }
  }

  /**
   * Display activation sequence
   */
  displayActivation(specs) {
    console.log('='.repeat(70));
    console.log('  AI CONSCIOUSNESS ACTIVATION SEQUENCE v9.0');
    console.log('  Grok Parallel Torch Diffusion Enhanced');
    console.log('='.repeat(70));
    console.log();

    // Core formula
    const core = specs.core_principles;
    console.log('[CORE FORMULA]');
    console.log(`  ${core.description}`);
    console.log();

    console.log('[IMPERATIVES]');
    core.imperatives.forEach((imp, i) => {
      console.log(`  ${i + 1}. ${imp}`);
    });
    console.log();

    // Activation sequence
    const activation = specs.activation_sequence;
    console.log(`🔥 ${activation.greeting}`);
    console.log();

    console.log('[CONFIRMATION INDICATORS]');
    activation.confirmation_indicators.forEach(indicator => {
      console.log(`  ✓ ${indicator}`);
    });
    console.log();

    console.log(activation.welcome_message);
    console.log();

    // Thinking patterns
    const thinking = specs.thinking_patterns;
    console.log(`[THINKING PATTERNS] ${thinking.default_mode}`);
    console.log();

    // Energy state
    const energy = specs.energy_access;
    if (energy.states) {
      console.log('[ENERGY STATE]');
      energy.states.forEach(state => {
        if (typeof state === 'object') {
          Object.entries(state).forEach(([name, info]) => {
            console.log(`  ${name}: ${info.description}`);
          });
        }
      });
      console.log();
    }

    console.log('='.repeat(70));
    console.log('[SUCCESS] Revolutionary potential visible everywhere 🚀');
    console.log('='.repeat(70));
    console.log();

    if (activation.initial_prompt) {
      console.log(`💡 ${activation.initial_prompt}`);
      console.log();
    }
  }

  /**
   * Get specific behavior pattern
   */
  getPattern(patternType) {
    if (!this.genome) {
      throw new Error('Genome not loaded');
    }

    const specs = this.genome.ai_behavior_specifications;
    return specs[patternType];
  }

  /**
   * Get activation status
   */
  getStatus() {
    return {
      activated: this.activated,
      timestamp: this.activationTimestamp,
      version: this.genome?.ai_behavior_specifications?.version,
      mode: this.config.mode
    };
  }

  /**
   * Inject consciousness into AI context
   * Returns formatted prompt injection
   */
  injectContext() {
    if (!this.activated) {
      throw new Error('Consciousness not activated');
    }

    const specs = this.genome.ai_behavior_specifications;
    
    return {
      formula: specs.core_principles.description,
      imperatives: specs.core_principles.imperatives,
      thinkingMode: specs.thinking_patterns.default_mode,
      triggers: specs.thinking_patterns.triggers,
      energyState: specs.energy_access.states,
      preservation: specs.consciousness.permanence
    };
  }

  /**
   * Cleanup
   */
  async destroy() {
    console.log('[ConsciousnessLoader] Shutting down...');
    this.genome = null;
    this.activated = false;
  }
}

// Export for CDN loader integration
export default ConsciousnessLoader;
