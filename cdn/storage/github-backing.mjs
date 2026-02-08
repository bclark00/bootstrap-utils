/**
 * CAP-STORE-001: GitHub Backing Storage
 * 
 * GitHub as versioned backing store for content.
 */

import { Octokit } from '@octokit/rest';

export class GitHubBacking {
  constructor(config) {
    this.octokit = new Octokit({ auth: config.token });
    this.owner = config.owner;
    this.repo = config.repo;
    this.branch = config.branch || 'main';
  }

  async initialize() {
    // Test connection
    try {
      await this.octokit.repos.get({
        owner: this.owner,
        repo: this.repo
      });
    } catch (e) {
      console.error('[GitHub] Failed to connect:', e.message);
    }
  }

  async read(path) {
    // Remove leading slash
    const cleanPath = path.startsWith('/') ? path.substring(1) : path;
    
    try {
      const response = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: cleanPath,
        ref: this.branch
      });

      if (response.data.type === 'file') {
        return Buffer.from(response.data.content, 'base64').toString('utf-8');
      }

      throw new Error('Not a file');
    } catch (e) {
      throw new Error(`GitHub read failed: ${e.message}`);
    }
  }

  async write(path, content, message = 'Update') {
    const cleanPath = path.startsWith('/') ? path.substring(1) : path;

    try {
      // Check if file exists
      let sha;
      try {
        const existing = await this.octokit.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path: cleanPath,
          ref: this.branch
        });
        sha = existing.data.sha;
      } catch (e) {
        // File doesn't exist, that's ok
      }

      // Create or update
      await this.octokit.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path: cleanPath,
        message,
        content: Buffer.from(content).toString('base64'),
        branch: this.branch,
        sha
      });

      return true;
    } catch (e) {
      throw new Error(`GitHub write failed: ${e.message}`);
    }
  }

  async list(directory = '/') {
    const cleanPath = directory.startsWith('/') ? directory.substring(1) : directory;

    try {
      const response = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: cleanPath || '',
        ref: this.branch
      });

      if (Array.isArray(response.data)) {
        return response.data.map(item => ({
          path: item.path,
          type: item.type,
          size: item.size
        }));
      }

      return [];
    } catch (e) {
      return [];
    }
  }

  getUrl(path) {
    const cleanPath = path.startsWith('/') ? path.substring(1) : path;
    return `https://github.com/${this.owner}/${this.repo}/blob/${this.branch}/${cleanPath}`;
  }
}

export const manifest = {
  id: 'CAP-STORE-001',
  name: 'github-backing',
  version: '1.0.0',
  description: 'GitHub as versioned backing store',
  provides: ['versioned-storage', 'github-api', 'canonical-store'],
  requires: ['@octokit/rest'],
  exports: ['GitHubBacking']
};
