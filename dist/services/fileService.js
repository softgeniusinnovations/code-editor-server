"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileService = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../db");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const FILE_STORAGE_PATH = process.env.FILE_STORAGE_PATH || './file_storage';
class FileService {
    static ensureRoomDirectory(roomId) {
        const roomPath = path_1.default.join(FILE_STORAGE_PATH, roomId);
        if (!require('fs').existsSync(roomPath)) {
            require('fs').mkdirSync(roomPath, { recursive: true });
        }
        return roomPath;
    }
    static async createRoom(roomId, roomName, password, ownerName) {
        try {
            console.log(`[FileService] Creating room: ${roomId} with name: ${roomName}, owner: ${ownerName}`);
            // Check if room already exists (any state)
            const existingRoom = await (0, db_1.query)('SELECT room_id, is_delete FROM rooms WHERE room_id = ?', [roomId]);
            if (existingRoom.length > 0) {
                console.log(`[FileService] Room already exists: ${roomId}`);
                if (existingRoom[0].is_delete) {
                    console.warn(`[FileService] Room ${roomId} is soft-deleted — refusing to recreate.`);
                    return false;
                }
                return true;
            }
            let hashedPassword = null;
            if (password && password.trim() !== '') {
                hashedPassword = await bcryptjs_1.default.hash(password, 10);
            }
            await (0, db_1.query)('INSERT INTO rooms (room_id, room_name, password, owner_name) VALUES (?, ?, ?, ?)', [roomId, roomName, hashedPassword, ownerName || null]);
            if (ownerName) {
                await (0, db_1.query)('INSERT INTO room_users (room_id, username, is_active, is_banned) VALUES (?, ?, 1, 0)', [roomId, ownerName]);
                console.log(`[FileService] Owner ${ownerName} added to room ${roomId} (active)`);
            }
            // Create room directory
            const roomPath = this.ensureRoomDirectory(roomId);
            console.log(`[FileService] Room directory created: ${roomPath}`);
            console.log(`[FileService] Room ${roomId} created successfully`);
            return true;
        }
        catch (error) {
            console.error('[FileService] Error creating room:', error);
            return false;
        }
    }
    static async createRoomIfNotExists(roomId, roomName, password, ownerName) {
        try {
            console.log(`[FileService] Checking if room exists: ${roomId}`);
            // Check if room exists
            const roomExists = await this.checkRoomExists(roomId);
            if (!roomExists) {
                console.log(`[FileService] Room does not exist, creating new room: ${roomId}`);
                return await this.createRoom(roomId, roomName, password, ownerName);
            }
            console.log(`[FileService] Room already exists: ${roomId}`);
            return true;
        }
        catch (error) {
            console.error('[FileService] Error in createRoomIfNotExists:', error);
            return false;
        }
    }
    static async isUserInRoom(roomId, username) {
        const rows = await (0, db_1.query)("SELECT * FROM room_users WHERE room_id = ? AND username = ?", [roomId, username]);
        return rows.length > 0;
    }
    static async addUserToRoom(roomId, username, isActive = false) {
        try {
            console.log(`[FileService] Adding/updating user ${username} to room ${roomId} with is_active: ${isActive}`);
            // Check if user already exists
            const existing = await (0, db_1.query)('SELECT id, is_banned FROM room_users WHERE room_id = ? AND username = ?', [roomId, username]);
            if (existing.length > 0) {
                if (existing[0].is_banned) {
                    console.warn(`[FileService] User ${username} is banned in room ${roomId} — cannot add/activate`);
                    return false;
                }
                // Update active status
                await (0, db_1.query)('UPDATE room_users SET is_active = ? WHERE room_id = ? AND username = ?', [isActive ? 1 : 0, roomId, username]);
                console.log(`[FileService] User ${username} updated in room ${roomId} (is_active=${isActive})`);
                return true;
            }
            // Insert new user
            await (0, db_1.query)('INSERT INTO room_users (room_id, username, is_active, is_banned) VALUES (?, ?, ?, 0)', [roomId, username, isActive ? 1 : 0]);
            console.log(`[FileService] User ${username} added to room ${roomId} successfully`);
            return true;
        }
        catch (error) {
            console.error('[FileService] Error adding/updating user to room:', error);
            return false;
        }
    }
    static async reactivateRoom(roomId) {
        try {
            console.log(`[FileService] Reactivating room: ${roomId}`);
            await (0, db_1.query)('UPDATE rooms SET is_active = 1, is_delete = 0 WHERE room_id = ?', [roomId]);
            console.log(`[FileService] Room ${roomId} reactivated successfully`);
            return true;
        }
        catch (error) {
            console.error('[FileService] Error reactivating room:', error);
            return false;
        }
    }
    static async isUserBanned(roomId, username) {
        try {
            const rows = await (0, db_1.query)("SELECT is_banned, reason FROM room_users WHERE room_id = ? AND username = ?", [roomId, username]);
            if (rows.length === 0) {
                return { banned: false, reason: null };
            }
            return {
                banned: Boolean(rows[0].is_banned),
                reason: rows[0].reason
            };
        }
        catch (error) {
            console.error('[FileService] Error checking if user is banned:', error);
            return { banned: false, reason: null };
        }
    }
    static async banUser(roomId, username, reason = "") {
        try {
            await (0, db_1.query)("UPDATE room_users SET is_banned = 1, reason = ? WHERE room_id = ? AND username = ?", [reason, roomId, username]);
            return true;
        }
        catch (error) {
            console.error('[FileService] Error banning user:', error);
            return false;
        }
    }
    static async unbanUser(roomId, username) {
        try {
            await (0, db_1.query)("UPDATE room_users SET is_banned = 0, reason = NULL WHERE room_id = ? AND username = ?", [roomId, username]);
            return true;
        }
        catch (error) {
            console.error('[FileService] Error unbanning user:', error);
            return false;
        }
    }
    static async activateUserInRoom(roomId, username) {
        try {
            await (0, db_1.query)("UPDATE room_users SET is_active = 1 WHERE room_id = ? AND username = ?", [roomId, username]);
            return true;
        }
        catch (error) {
            console.error('[FileService] Error activating user in room:', error);
            return false;
        }
    }
    static async checkRoomStatus(roomId) {
        try {
            const results = await (0, db_1.query)('SELECT is_active, is_delete, owner_name FROM rooms WHERE room_id = ?', [roomId]);
            if (results.length === 0) {
                // Room doesn't exist - return default values
                return { isActive: false, isDeleted: false };
            }
            const room = results[0];
            return {
                isActive: Boolean(room.is_active),
                isDeleted: Boolean(room.is_delete),
                ownerName: room.owner_name
            };
        }
        catch (error) {
            console.error('[FileService] Error checking room status:', error);
            return { isActive: false, isDeleted: false };
        }
    }
    static async updateUserActiveStatus(roomId, username, isActive) {
        try {
            await (0, db_1.query)("UPDATE room_users SET is_active = ? WHERE room_id = ? AND username = ?", [isActive, roomId, username]);
            console.log(`[FileService] User ${username} active status updated to: ${isActive}`);
            return true;
        }
        catch (error) {
            console.error('[FileService] Error updating user active status:', error);
            return false;
        }
    }
    static async getUserActiveStatus(roomId, username) {
        try {
            const rows = await (0, db_1.query)("SELECT is_active FROM room_users WHERE room_id = ? AND username = ?", [roomId, username]);
            if (rows.length === 0) {
                return false;
            }
            return Boolean(rows[0].is_active);
        }
        catch (error) {
            console.error('[FileService] Error getting user active status:', error);
            return false;
        }
    }
    static async getPendingUsers(roomId) {
        try {
            const rows = await (0, db_1.query)("SELECT username, photo FROM room_users WHERE room_id = ? AND is_active = 0 AND is_banned = 0", [roomId]);
            return rows;
        }
        catch (error) {
            console.error('[FileService] Error getting pending users:', error);
            return [];
        }
    }
    static async approveUser(roomId, username) {
        try {
            await (0, db_1.query)("UPDATE room_users SET is_active = 1 WHERE room_id = ? AND username = ?", [roomId, username]);
            return true;
        }
        catch (error) {
            console.error('[FileService] Error approving user:', error);
            return false;
        }
    }
    static async rejectUser(roomId, username) {
        try {
            await (0, db_1.query)("DELETE FROM room_users WHERE room_id = ? AND username = ? AND is_active = 0", [roomId, username]);
            return true;
        }
        catch (error) {
            console.error('[FileService] Error rejecting user:', error);
            return false;
        }
    }
    static async isUserRoomOwner(roomId, username) {
        try {
            const results = await (0, db_1.query)('SELECT owner_name FROM rooms WHERE room_id = ?', [roomId]);
            if (results.length === 0) {
                return false;
            }
            return results[0].owner_name === username;
        }
        catch (error) {
            console.error('[FileService] Error checking if user is room owner:', error);
            return false;
        }
    }
    static async checkRoomExists(roomId) {
        try {
            const results = await (0, db_1.query)('SELECT room_id FROM rooms WHERE room_id = ?', [roomId]);
            const exists = results.length > 0;
            console.log(`[FileService] Room ${roomId} exists: ${exists}`);
            return exists;
        }
        catch (error) {
            console.error('[FileService] Error checking room existence:', error);
            return false;
        }
    }
    static async getRoomInfo(roomId) {
        try {
            const results = await (0, db_1.query)(`SELECT r.room_id, r.room_name, r.owner_name, r.password, r.created_at, r.is_active, r.is_delete, r.created_at,
                        COUNT(ru.id) as user_count
                 FROM rooms r
                 LEFT JOIN room_users ru ON r.room_id = ru.room_id
                 WHERE r.room_id = ? 
                 GROUP BY r.room_id`, [roomId]);
            if (results.length === 0) {
                return null;
            }
            const room = results[0];
            return {
                room_id: room.room_id,
                room_name: room.room_name,
                owner_name: room.owner_name,
                has_password: room.password !== null,
                is_active: Boolean(room.is_active),
                is_delete: Boolean(room.is_delete),
                created_at: room.created_at,
                user_count: parseInt(room.user_count) || 0
            };
        }
        catch (error) {
            console.error('[FileService] Error getting room info:', error);
            return null;
        }
    }
    static async verifyRoomPassword(roomId, password) {
        try {
            const results = await (0, db_1.query)('SELECT password FROM rooms WHERE room_id = ? AND is_active = 1', [roomId]);
            if (results.length === 0) {
                return false;
            }
            const room = results[0];
            // If room has no password, allow access
            if (room.password === null) {
                return true;
            }
            // Verify password
            const isValid = await bcryptjs_1.default.compare(password, room.password);
            console.log(`[FileService] Password verification for room ${roomId}: ${isValid}`);
            return isValid;
        }
        catch (error) {
            console.error('[FileService] Error verifying room password:', error);
            return false;
        }
    }
    static async getRoomUsers(roomId) {
        try {
            const results = await (0, db_1.query)('SELECT username FROM room_users WHERE room_id = ?', [roomId]);
            return results.map((row) => row.username);
        }
        catch (error) {
            console.error('[FileService] Error getting room users:', error);
            return [];
        }
    }
    static async createFile(roomId, filename, content = '', createdBy, parentDirId = null, fileId) {
        try {
            const finalFileId = fileId || this.generateFileId();
            const filePath = path_1.default.join(this.ensureRoomDirectory(roomId), filename);
            console.log(`[FileService] Creating file: ${filename} in room ${roomId} with ID: ${finalFileId}`);
            // Write file to filesystem
            await promises_1.default.writeFile(filePath, content);
            // Store in database
            await (0, db_1.query)(`INSERT INTO room_files 
                 (room_id, file_id, filename, file_path, content, file_size, file_type, parent_dir_id, created_by) 
                 VALUES (?, ?, ?, ?, ?, ?, 'file', ?, ?)`, [roomId, finalFileId, filename, filePath, content, Buffer.byteLength(content, 'utf8'), parentDirId, createdBy]);
            console.log(`[FileService] File created successfully: ${filename} with ID: ${finalFileId}`);
            return finalFileId;
        }
        catch (error) {
            console.error('[FileService] Error creating file:', error);
            throw error;
        }
    }
    static async createDirectory(roomId, dirname, createdBy, parentDirId = null) {
        try {
            const dirId = this.generateFileId();
            const dirPath = path_1.default.join(this.ensureRoomDirectory(roomId), dirname);
            console.log(`[FileService] Creating directory: ${dirname} in room ${roomId}`);
            // Create directory in filesystem
            await promises_1.default.mkdir(dirPath, { recursive: true });
            // Store in database
            await (0, db_1.query)(`INSERT INTO room_files 
                 (room_id, file_id, filename, file_path, content, file_size, file_type, parent_dir_id, created_by) 
                 VALUES (?, ?, ?, ?, NULL, 0, 'directory', ?, ?)`, [roomId, dirId, dirname, dirPath, parentDirId, createdBy]);
            console.log(`[FileService] Directory created successfully: ${dirname} with ID: ${dirId}`);
            return dirId;
        }
        catch (error) {
            console.error('[FileService] Error creating directory:', error);
            throw error;
        }
    }
    static async updateFileContent(roomId, fileId, content, updatedBy) {
        try {
            console.log(`[FileService] Updating file content: ${fileId} in room ${roomId}`);
            // First check if file exists
            const file = await (0, db_1.query)('SELECT * FROM room_files WHERE room_id = ? AND file_id = ?', [roomId, fileId]);
            if (file.length === 0) {
                console.log(`[FileService] File not found, creating new file: ${fileId}`);
                // If file doesn't exist, create it
                await this.createFile(roomId, 'untitled.txt', content, updatedBy, null, fileId);
                return;
            }
            const fileData = file[0];
            // Update file in filesystem
            await promises_1.default.writeFile(fileData.file_path, content);
            // Update in database
            await (0, db_1.query)(`UPDATE room_files 
                 SET content = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE room_id = ? AND file_id = ?`, [content, Buffer.byteLength(content, 'utf8'), roomId, fileId]);
            console.log(`[FileService] File content updated: ${fileId} in room ${roomId}`);
        }
        catch (error) {
            console.error('[FileService] Error updating file content:', error);
            throw error;
        }
    }
    static async getFileById(roomId, fileId) {
        try {
            const files = await (0, db_1.query)('SELECT * FROM room_files WHERE room_id = ? AND file_id = ?', [roomId, fileId]);
            if (files.length === 0) {
                return null;
            }
            return files[0];
        }
        catch (error) {
            console.error('[FileService] Error getting file by ID:', error);
            return null;
        }
    }
    static async renameFile(roomId, fileId, newName) {
        try {
            const file = await (0, db_1.query)('SELECT * FROM room_files WHERE room_id = ? AND file_id = ?', [roomId, fileId]);
            if (file.length === 0) {
                throw new Error('File not found');
            }
            const fileData = file[0];
            const newPath = path_1.default.join(path_1.default.dirname(fileData.file_path), newName);
            // Rename in filesystem
            await promises_1.default.rename(fileData.file_path, newPath);
            // Update in database
            await (0, db_1.query)(`UPDATE room_files 
                 SET filename = ?, file_path = ? 
                 WHERE room_id = ? AND file_id = ?`, [newName, newPath, roomId, fileId]);
            console.log(`[FileService] File renamed: ${fileId} to ${newName} in room ${roomId}`);
        }
        catch (error) {
            console.error('[FileService] Error renaming file:', error);
            throw error;
        }
    }
    static async deleteFile(roomId, fileId) {
        try {
            const file = await (0, db_1.query)('SELECT * FROM room_files WHERE room_id = ? AND file_id = ?', [roomId, fileId]);
            if (file.length === 0) {
                throw new Error('File not found');
            }
            const fileData = file[0];
            // Delete from filesystem
            if (fileData.file_type === 'directory') {
                await promises_1.default.rm(fileData.file_path, { recursive: true });
            }
            else {
                await promises_1.default.unlink(fileData.file_path);
            }
            // Delete from database
            await (0, db_1.query)('DELETE FROM room_files WHERE room_id = ? AND file_id = ?', [roomId, fileId]);
            console.log(`[FileService] File deleted: ${fileId} from room ${roomId}`);
        }
        catch (error) {
            console.error('[FileService] Error deleting file:', error);
            throw error;
        }
    }
    static async getFileStructure(roomId) {
        try {
            const files = await (0, db_1.query)('SELECT * FROM room_files WHERE room_id = ? ORDER BY file_type, filename', [roomId]);
            return this.buildFileTree(files);
        }
        catch (error) {
            console.error('[FileService] Error getting file structure:', error);
            return [];
        }
    }
    static buildFileTree(files) {
        const fileMap = new Map();
        const rootNodes = [];
        // Create map of all files
        files.forEach(file => {
            fileMap.set(file.file_id, {
                id: file.file_id,
                name: file.filename,
                type: file.file_type,
                content: file.content,
                children: []
            });
        });
        // Build tree structure
        files.forEach(file => {
            const fileNode = fileMap.get(file.file_id);
            if (file.parent_dir_id && fileMap.has(file.parent_dir_id)) {
                const parent = fileMap.get(file.parent_dir_id);
                parent.children.push(fileNode);
            }
            else {
                rootNodes.push(fileNode);
            }
        });
        return rootNodes;
    }
    static async getFileContent(roomId, fileId) {
        try {
            const file = await (0, db_1.query)('SELECT content FROM room_files WHERE room_id = ? AND file_id = ?', [roomId, fileId]);
            if (file.length === 0) {
                throw new Error('File not found');
            }
            return file[0].content || '';
        }
        catch (error) {
            console.error('[FileService] Error getting file content:', error);
            throw error;
        }
    }
    static async syncFileStructure(roomId, fileStructure, username) {
        try {
            console.log(`[FileService] Syncing file structure for room: ${roomId}`);
            // Validate fileStructure parameter
            if (!fileStructure || !Array.isArray(fileStructure)) {
                console.error('[FileService] Invalid file structure: expected array');
                throw new Error('File structure must be an array');
            }
            console.log(`[FileService] Processing ${fileStructure.length} root nodes`);
            // First, get existing files
            const existingFiles = await (0, db_1.query)('SELECT file_id FROM room_files WHERE room_id = ?', [roomId]);
            const existingFileIds = new Set(existingFiles.map((file) => file.file_id));
            // Recursively process file structure
            const processNode = async (node, parentDirId = null) => {
                // Validate node structure
                if (!node.id || !node.name || !node.type) {
                    console.warn('[FileService] Skipping invalid node:', node);
                    return;
                }
                if (!existingFileIds.has(node.id)) {
                    console.log(`[FileService] Creating ${node.type}: ${node.name} (${node.id})`);
                    if (node.type === 'file') {
                        await this.createFile(roomId, node.name, node.content || '', username, parentDirId, node.id);
                    }
                    else if (node.type === 'directory') {
                        await this.createDirectory(roomId, node.name, username, parentDirId);
                        // Process children recursively (with validation)
                        if (node.children && Array.isArray(node.children)) {
                            console.log(`[FileService] Processing ${node.children.length} children of ${node.name}`);
                            for (const child of node.children) {
                                await processNode(child, node.id);
                            }
                        }
                    }
                }
                else {
                    console.log(`[FileService] ${node.type} already exists: ${node.name} (${node.id})`);
                }
            };
            // Process all root nodes
            for (const node of fileStructure) {
                await processNode(node);
            }
            console.log(`[FileService] File structure synced for room: ${roomId}`);
        }
        catch (error) {
            console.error('[FileService] Error syncing file structure:', error);
            throw error;
        }
    }
    static async saveChatMessage(roomId, messageId, username, message) {
        try {
            console.log(`[FileService] Saving chat message for room: ${roomId}, user: ${username}`);
            const result = await (0, db_1.query)(`INSERT INTO room_chats (room_id, message_id, username, message) 
             VALUES (?, ?, ?, ?)`, [roomId, messageId, username, message]);
            console.log(`[FileService] Chat message saved successfully: ${messageId}`);
            return true;
        }
        catch (error) {
            console.error('[FileService] Error saving chat message:', error);
            return false;
        }
    }
    static async getRoomChatHistory(roomId) {
        try {
            console.log(`[FileService] Loading chat history for room: ${roomId}`);
            const messages = await (0, db_1.query)(`SELECT message_id as id, username, message, timestamp 
             FROM room_chats 
             WHERE room_id = ? 
             ORDER BY timestamp ASC`, [roomId]);
            // Format the timestamp for frontend
            const formattedMessages = messages.map((msg) => ({
                ...msg,
                timestamp: this.formatChatTimestamp(msg.timestamp)
            }));
            console.log(`[FileService] Loaded ${formattedMessages.length} chat messages for room: ${roomId}`);
            return formattedMessages;
        }
        catch (error) {
            console.error('[FileService] Error loading chat history:', error);
            return [];
        }
    }
    static formatChatTimestamp(timestamp) {
        // You can use your existing formatDate function or create a simple formatter
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }
    static async updateUserPhoto(roomId, username, photo) {
        try {
            await (0, db_1.query)("UPDATE room_users SET photo = ? WHERE room_id = ? AND username = ?", [photo, roomId, username]);
            const rows = await (0, db_1.query)("SELECT username, photo FROM room_users WHERE room_id = ? AND username = ?", [roomId, username]);
            if (rows.length === 0)
                return null;
            return rows[0];
        }
        catch (error) {
            console.error("[FileService] Error updating user photo:", error);
            return null;
        }
    }
    static async getUserPhoto(roomId, username) {
        try {
            const rows = await (0, db_1.query)("SELECT photo FROM room_users WHERE room_id = ? AND username = ?", [roomId, username]);
            if (rows.length === 0)
                return null;
            const photo = rows[0].photo;
            return photo && photo.trim() !== '' ? photo : null;
        }
        catch (error) {
            console.error("[FileService] Error getting user photo:", error);
            return null;
        }
    }
    static generateFileId() {
        return `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}
exports.FileService = FileService;
