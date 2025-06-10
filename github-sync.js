/**
 * GitHub Gists Sync Manager
 * Handles authentication and synchronization with GitHub Gists
 */

class GitHubSync {
    constructor() {
        this.baseUrl = 'https://api.github.com';
        this.clientId = 'YOUR_GITHUB_CLIENT_ID'; // We'll need to register this
        this.redirectUri = null; // Not needed for token-based auth
        this.accessToken = null;
        this.gistId = null;
        this.gistFilename = 'bookmarkpp-data.json';
    }

    /**
     * Initialize sync - load saved settings
     */
    async init() {
        try {
            const result = await chrome.storage.local.get(['github_access_token', 'github_gist_id']);
            this.accessToken = result.github_access_token;
            this.gistId = result.github_gist_id;
            
            if (this.accessToken) {
                // Verify token is still valid
                const isValid = await this.verifyToken();
                if (!isValid) {
                    await this.clearAuth();
                }
            }
        } catch (error) {
            console.error('Error initializing GitHub sync:', error);
        }
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return !!this.accessToken;
    }

    /**
     * Authenticate with GitHub using OAuth
     */
    async authenticate() {
        try {
            // For now, we'll use a personal access token approach
            // Later we can implement full OAuth flow
            return this.authenticateWithToken();
        } catch (error) {
            console.error('GitHub authentication failed:', error);
            throw new Error('Failed to authenticate with GitHub');
        }
    }

    /**
     * Authenticate using personal access token (simpler for users initially)
     */
    async authenticateWithToken() {
        return new Promise((resolve, reject) => {
            // This will be called from the settings UI
            // For now, we'll implement token-based auth
            const modal = this.createTokenInputModal();
            document.body.appendChild(modal);
            
            const tokenInput = modal.querySelector('#githubTokenInput');
            const submitBtn = modal.querySelector('#submitTokenBtn');
            const cancelBtn = modal.querySelector('#cancelTokenBtn');
            
            submitBtn.addEventListener('click', async () => {
                const token = tokenInput.value.trim();
                if (!token) {
                    alert('Please enter a valid token');
                    return;
                }
                
                try {
                    this.accessToken = token;
                    const isValid = await this.verifyToken();
                    
                    if (isValid) {
                        await chrome.storage.local.set({ github_access_token: token });
                        document.body.removeChild(modal);
                        resolve(true);
                    } else {
                        alert('Invalid GitHub token. Please check your token and try again.');
                        this.accessToken = null;
                    }
                } catch (error) {
                    alert('Error verifying token: ' + error.message);
                    this.accessToken = null;
                }
            });
            
            cancelBtn.addEventListener('click', () => {
                document.body.removeChild(modal);
                reject(new Error('Authentication cancelled'));
            });
        });
    }

    /**
     * Create token input modal
     */
    createTokenInputModal() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>GitHub Authentication</h3>
                </div>
                <div class="modal-body">
                    <p>To sync your bookmarks with GitHub Gists, you need a Personal Access Token.</p>
                    <p><strong>Steps to create a token:</strong></p>
                    <ol>
                        <li>Go to <a href="https://github.com/settings/tokens" target="_blank">GitHub Settings → Developer settings → Personal access tokens</a></li>
                        <li>Click "Generate new token" → "Generate new token (classic)"</li>
                        <li>Give it a name like "BookmarkPp Sync"</li>
                        <li>Select the <strong>"gist"</strong> scope (this allows creating/updating gists)</li>
                        <li>Click "Generate token" and copy it</li>
                    </ol>
                    <div style="margin-top: 1rem;">
                        <label for="githubTokenInput">Paste your token here:</label>
                        <input type="password" id="githubTokenInput" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" 
                               style="width: 100%; padding: 0.5rem; margin-top: 0.5rem; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    <p style="font-size: 0.9rem; color: #666; margin-top: 0.5rem;">
                        Your token will be stored securely in your browser and only used to sync your bookmarks.
                    </p>
                </div>
                <div class="modal-footer">
                    <button id="cancelTokenBtn" class="btn btn-secondary">Cancel</button>
                    <button id="submitTokenBtn" class="btn btn-primary">Connect to GitHub</button>
                </div>
            </div>
        `;
        return modal;
    }

    /**
     * Verify if the access token is valid
     */
    async verifyToken() {
        if (!this.accessToken) return false;
        
        try {
            const response = await fetch(`${this.baseUrl}/user`, {
                headers: {
                    'Authorization': `token ${this.accessToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            return response.ok;
        } catch (error) {
            console.error('Error verifying token:', error);
            return false;
        }
    }

    /**
     * Get user info
     */
    async getUserInfo() {
        if (!this.accessToken) throw new Error('Not authenticated');
        
        const response = await fetch(`${this.baseUrl}/user`, {
            headers: {
                'Authorization': `token ${this.accessToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to get user info');
        }
        
        return response.json();
    }

    /**
     * Save bookmarks to GitHub Gist
     */
    async saveBookmarks(bookmarkData) {
        if (!this.accessToken) {
            throw new Error('Not authenticated with GitHub');
        }

        try {
            const gistData = {
                description: 'BookmarkPp - Personal Bookmark Collection',
                public: false,
                files: {
                    [this.gistFilename]: {
                        content: JSON.stringify(bookmarkData, null, 2)
                    }
                }
            };

            const url = this.gistId 
                ? `${this.baseUrl}/gists/${this.gistId}`
                : `${this.baseUrl}/gists`;
            
            const method = this.gistId ? 'PATCH' : 'POST';

            const response = await fetch(url, {
                method,
                headers: {
                    'Authorization': `token ${this.accessToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gistData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`GitHub API error: ${error.message || response.statusText}`);
            }

            const result = await response.json();
            
            // Save gist ID for future updates
            if (!this.gistId) {
                this.gistId = result.id;
                await chrome.storage.local.set({ github_gist_id: result.id });
            }

            return {
                success: true,
                gistId: result.id,
                url: result.html_url,
                updatedAt: result.updated_at
            };
        } catch (error) {
            console.error('Error saving to GitHub:', error);
            throw error;
        }
    }

    /**
     * Load bookmarks from GitHub Gist
     */
    async loadBookmarks() {
        if (!this.accessToken || !this.gistId) {
            throw new Error('Not authenticated or no gist found');
        }

        try {
            const response = await fetch(`${this.baseUrl}/gists/${this.gistId}`, {
                headers: {
                    'Authorization': `token ${this.accessToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to load gist: ${response.statusText}`);
            }

            const gist = await response.json();
            const file = gist.files[this.gistFilename];
            
            if (!file) {
                throw new Error('Bookmark data file not found in gist');
            }

            const bookmarkData = JSON.parse(file.content);
            
            return {
                success: true,
                data: bookmarkData,
                updatedAt: gist.updated_at,
                url: gist.html_url
            };
        } catch (error) {
            console.error('Error loading from GitHub:', error);
            throw error;
        }
    }

    /**
     * Check if there are newer changes on GitHub
     */
    async checkForUpdates() {
        if (!this.accessToken || !this.gistId) return null;

        try {
            const response = await fetch(`${this.baseUrl}/gists/${this.gistId}`, {
                headers: {
                    'Authorization': `token ${this.accessToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!response.ok) return null;

            const gist = await response.json();
            return {
                updatedAt: gist.updated_at,
                url: gist.html_url
            };
        } catch (error) {
            console.error('Error checking for updates:', error);
            return null;
        }
    }

    /**
     * Clear authentication data
     */
    async clearAuth() {
        this.accessToken = null;
        this.gistId = null;
        await chrome.storage.local.remove(['github_access_token', 'github_gist_id']);
    }

    /**
     * Get sync status
     */
    getSyncStatus() {
        return {
            isAuthenticated: this.isAuthenticated(),
            hasGist: !!this.gistId,
            gistId: this.gistId
        };
    }
}

// Create global instance
const githubSync = new GitHubSync();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = githubSync;
} else if (typeof window !== 'undefined') {
    window.githubSync = githubSync;
} 