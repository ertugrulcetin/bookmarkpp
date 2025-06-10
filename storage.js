/**
 * BookmarkPp Storage Utility
 * Manages local storage operations for bookmarks with domain-based organization
 */

class BookmarkStorage {
    constructor() {
        this.STORAGE_KEY = 'bookmarkpp_data';
        this.SETTINGS_KEY = 'bookmarkpp_settings';
    }

    /**
     * Get all bookmark data
     * @returns {Object} Domain-based bookmark data
     */
    async getAllBookmarks() {
        try {
            const result = await chrome.storage.local.get([this.STORAGE_KEY]);
            return result[this.STORAGE_KEY] || {};
        } catch (error) {
            console.error('Error getting bookmarks:', error);
            return {};
        }
    }

    /**
     * Get bookmarks for a specific domain
     * @param {string} domain - The domain to get bookmarks for
     * @returns {Array} Array of bookmarks for the domain
     */
    async getBookmarksByDomain(domain) {
        const allBookmarks = await this.getAllBookmarks();
        return allBookmarks[domain] || [];
    }

    /**
     * Save a new bookmark or update existing one
     * @param {Object} bookmarkData - The bookmark data to save
     */
    async saveBookmark(bookmarkData) {
        try {
            const { url, title, description, favicon, ogImage, notes = [], created_at } = bookmarkData;
            const domain = this.extractDomain(url);
            const now = new Date().toISOString();

            const allBookmarks = await this.getAllBookmarks();
            const domainBookmarks = allBookmarks[domain] || [];

            // Check if URL already exists
            const existingIndex = domainBookmarks.findIndex(bookmark => bookmark.url === url);

            const bookmarkEntry = {
                created_at: created_at || now, // Use provided timestamp or current time
                title,
                description,
                url,
                favicon,
                ogImage,
                notes: notes.map(note => ({
                    created_at: note.created_at || now,
                    text: note.text
                }))
            };

            if (existingIndex !== -1) {
                // Update existing bookmark
                domainBookmarks[existingIndex] = {
                    ...domainBookmarks[existingIndex],
                    created_at: created_at || now, // Use provided timestamp or current time for updates too
                    title,
                    description,
                    favicon,
                    ogImage,
                    notes: [
                        ...domainBookmarks[existingIndex].notes,
                        ...bookmarkEntry.notes
                    ]
                };
            } else {
                // Add new bookmark
                domainBookmarks.push(bookmarkEntry);
            }

            // Sort by created_at DESC
            domainBookmarks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            allBookmarks[domain] = domainBookmarks;

            await chrome.storage.local.set({
                [this.STORAGE_KEY]: allBookmarks
            });

            return { success: true, isNew: existingIndex === -1 };
        } catch (error) {
            console.error('Error saving bookmark:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Add a note to an existing bookmark
     * @param {string} url - The bookmark URL
     * @param {string} noteText - The note text to add
     */
    async addNoteToBookmark(url, noteText) {
        try {
            const domain = this.extractDomain(url);
            const allBookmarks = await this.getAllBookmarks();
            const domainBookmarks = allBookmarks[domain] || [];

            const bookmarkIndex = domainBookmarks.findIndex(bookmark => bookmark.url === url);
            
            if (bookmarkIndex === -1) {
                throw new Error('Bookmark not found');
            }

            const now = new Date().toISOString();
            domainBookmarks[bookmarkIndex].notes.push({
                created_at: now,
                text: noteText
            });

            allBookmarks[domain] = domainBookmarks;

            await chrome.storage.local.set({
                [this.STORAGE_KEY]: allBookmarks
            });

            return { success: true };
        } catch (error) {
            console.error('Error adding note:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete a note from an existing bookmark
     * @param {string} url - The bookmark URL
     * @param {string} noteId - The note ID (created_at timestamp) to delete
     */
    async deleteNoteFromBookmark(url, noteId) {
        try {
            const domain = this.extractDomain(url);
            const allBookmarks = await this.getAllBookmarks();
            const domainBookmarks = allBookmarks[domain] || [];

            const bookmarkIndex = domainBookmarks.findIndex(bookmark => bookmark.url === url);
            
            if (bookmarkIndex === -1) {
                throw new Error('Bookmark not found');
            }

            // Filter out the note with the matching created_at timestamp
            domainBookmarks[bookmarkIndex].notes = domainBookmarks[bookmarkIndex].notes.filter(
                note => note.created_at !== noteId
            );

            allBookmarks[domain] = domainBookmarks;

            await chrome.storage.local.set({
                [this.STORAGE_KEY]: allBookmarks
            });

            return { success: true };
        } catch (error) {
            console.error('Error deleting note:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete a bookmark
     * @param {string} url - The bookmark URL to delete
     */
    async deleteBookmark(url) {
        try {
            const domain = this.extractDomain(url);
            const allBookmarks = await this.getAllBookmarks();
            const domainBookmarks = allBookmarks[domain] || [];

            const filteredBookmarks = domainBookmarks.filter(bookmark => bookmark.url !== url);
            
            if (filteredBookmarks.length === 0) {
                // Remove the domain key if no bookmarks left
                delete allBookmarks[domain];
            } else {
                allBookmarks[domain] = filteredBookmarks;
            }

            await chrome.storage.local.set({
                [this.STORAGE_KEY]: allBookmarks
            });

            return { success: true };
        } catch (error) {
            console.error('Error deleting bookmark:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Clear all bookmarks
     */
    async clearAllBookmarks() {
        try {
            await chrome.storage.local.set({
                [this.STORAGE_KEY]: {}
            });

            return { success: true };
        } catch (error) {
            console.error('Error clearing all bookmarks:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all bookmarks sorted by date (newest first)
     * @returns {Array} Flattened array of all bookmarks sorted by date
     */
    async getAllBookmarksSorted() {
        const allBookmarks = await this.getAllBookmarks();
        const flatBookmarks = [];

        for (const [domain, bookmarks] of Object.entries(allBookmarks)) {
            flatBookmarks.push(...bookmarks);
        }

        return flatBookmarks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    /**
     * Search bookmarks by title, description, or notes
     * @param {string} query - Search query
     * @returns {Array} Matching bookmarks
     */
    async searchBookmarks(query) {
        const allBookmarks = await this.getAllBookmarksSorted();
        const searchTerm = query.toLowerCase();

        return allBookmarks.filter(bookmark => {
            const titleMatch = bookmark.title.toLowerCase().includes(searchTerm);
            const descMatch = bookmark.description.toLowerCase().includes(searchTerm);
            const notesMatch = bookmark.notes.some(note => 
                note.text.toLowerCase().includes(searchTerm)
            );
            const urlMatch = bookmark.url.toLowerCase().includes(searchTerm);

            return titleMatch || descMatch || notesMatch || urlMatch;
        });
    }

    /**
     * Extract domain from URL
     * @param {string} url - The URL to extract domain from
     * @returns {string} The domain
     */
    extractDomain(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname.replace('www.', '');
        } catch (error) {
            console.error('Invalid URL:', url);
            return 'unknown';
        }
    }

    /**
     * Get storage usage statistics
     * @returns {Object} Storage statistics
     */
    async getStorageStats() {
        try {
            const allBookmarks = await this.getAllBookmarks();
            const domains = Object.keys(allBookmarks);
            const totalBookmarks = Object.values(allBookmarks).reduce((total, bookmarks) => total + bookmarks.length, 0);
            
            return {
                totalDomains: domains.length,
                totalBookmarks,
                domains: domains.map(domain => ({
                    domain,
                    count: allBookmarks[domain].length
                })).sort((a, b) => b.count - a.count)
            };
        } catch (error) {
            console.error('Error getting storage stats:', error);
            return { totalDomains: 0, totalBookmarks: 0, domains: [] };
        }
    }

    /**
     * Export all bookmarks as JSON
     * @returns {string} JSON string of all bookmarks
     */
    async exportBookmarks() {
        const allBookmarks = await this.getAllBookmarks();
        return JSON.stringify(allBookmarks, null, 2);
    }

    /**
     * Import bookmarks from JSON
     * @param {string} jsonData - JSON string of bookmarks to import
     * @param {boolean} merge - Whether to merge with existing data or replace
     */
    async importBookmarks(jsonData, merge = true) {
        try {
            const importedData = JSON.parse(jsonData);
            
            if (merge) {
                const existingData = await this.getAllBookmarks();
                // Merge logic - combine bookmarks by domain
                for (const [domain, bookmarks] of Object.entries(importedData)) {
                    if (existingData[domain]) {
                        // Merge and deduplicate by URL
                        const existingUrls = new Set(existingData[domain].map(b => b.url));
                        const newBookmarks = bookmarks.filter(b => !existingUrls.has(b.url));
                        existingData[domain] = [...existingData[domain], ...newBookmarks];
                        existingData[domain].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                    } else {
                        existingData[domain] = bookmarks;
                    }
                }
                await chrome.storage.local.set({ [this.STORAGE_KEY]: existingData });
            } else {
                await chrome.storage.local.set({ [this.STORAGE_KEY]: importedData });
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error importing bookmarks:', error);
            return { success: false, error: error.message };
        }
    }
}

// Create a singleton instance
const bookmarkStorage = new BookmarkStorage();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = bookmarkStorage;
} else if (typeof window !== 'undefined') {
    window.bookmarkStorage = bookmarkStorage;
} 