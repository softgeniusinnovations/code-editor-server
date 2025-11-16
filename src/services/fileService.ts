import fs from 'fs/promises';
import path from 'path';
import { query } from '../db';
import { RoomFile, FileStructure, RoomInfo } from '../types/user';
import bcrypt from 'bcryptjs';

const FILE_STORAGE_PATH = process.env.FILE_STORAGE_PATH || './file_storage';

export class FileService {
    private static ensureRoomDirectory(roomId: string): string {
        const roomPath = path.join(FILE_STORAGE_PATH, roomId);
        if (!require('fs').existsSync(roomPath)) {
            require('fs').mkdirSync(roomPath, { recursive: true });
        }
        return roomPath;
    }

    static async createRoom(roomId: string, roomName: string, password?: string): Promise<boolean> {
        try {
            console.log(`[FileService] Creating room: ${roomId} with name: ${roomName}`);

            // First check if room already exists
            const existingRoom: any = await query(
                'SELECT room_id FROM rooms WHERE room_id = ?',
                [roomId]
            );

            if (existingRoom.length > 0) {
                console.log(`[FileService] Room already exists: ${roomId}`);
                return true;
            }

            // Hash password if provided
            let hashedPassword = null;
            if (password && password.trim() !== '') {
                hashedPassword = await bcrypt.hash(password, 10);
            }

            // Insert into rooms table
            const result: any = await query(
                'INSERT INTO rooms (room_id, room_name, password) VALUES (?, ?, ?)',
                [roomId, roomName, hashedPassword]
            );

            // Create room directory
            const roomPath = this.ensureRoomDirectory(roomId);
            console.log(`[FileService] Room directory created: ${roomPath}`);

            console.log(`[FileService] Room ${roomId} created successfully`);
            return true;
        } catch (error) {
            console.error('[FileService] Error creating room:', error);
            return false;
        }
    }

    static async createRoomIfNotExists(roomId: string, roomName: string, password?: string): Promise<boolean> {
        try {
            console.log(`[FileService] Checking if room exists: ${roomId}`);

            // Check if room exists
            const roomExists = await this.checkRoomExists(roomId);

            if (!roomExists) {
                console.log(`[FileService] Room does not exist, creating new room: ${roomId}`);
                return await this.createRoom(roomId, roomName, password);
            }

            console.log(`[FileService] Room already exists: ${roomId}`);
            return true;
        } catch (error) {
            console.error('[FileService] Error in createRoomIfNotExists:', error);
            return false;
        }
    }

    static async addUserToRoom(roomId: string, username: string): Promise<boolean> {
        try {
            console.log(`[FileService] Adding user ${username} to room ${roomId}`);

            const result: any = await query(
                'INSERT INTO room_users (room_id, username) VALUES (?, ?)',
                [roomId, username]
            );

            console.log(`[FileService] User ${username} added to room ${roomId} successfully`);
            return true;
        } catch (error) {
            console.error('[FileService] Error adding user to room:', error);
            return false;
        }
    }

    static async checkRoomExists(roomId: string): Promise<boolean> {
        try {
            const results: any = await query(
                'SELECT room_id FROM rooms WHERE room_id = ? AND is_active = 1',
                [roomId]
            );
            const exists = results.length > 0;
            console.log(`[FileService] Room ${roomId} exists: ${exists}`);
            return exists;
        } catch (error) {
            console.error('[FileService] Error checking room existence:', error);
            return false;
        }
    }

    static async getRoomInfo(roomId: string): Promise<RoomInfo | null> {
        try {
            const results: any = await query(
                `SELECT r.room_id, r.room_name, r.password, r.created_at, 
                        COUNT(ru.id) as user_count
                 FROM rooms r
                 LEFT JOIN room_users ru ON r.room_id = ru.room_id
                 WHERE r.room_id = ? AND r.is_active = 1
                 GROUP BY r.room_id`,
                [roomId]
            );

            if (results.length === 0) {
                return null;
            }

            const room = results[0];
            return {
                room_id: room.room_id,
                room_name: room.room_name,
                has_password: room.password !== null,
                created_at: room.created_at,
                user_count: parseInt(room.user_count) || 0
            };
        } catch (error) {
            console.error('[FileService] Error getting room info:', error);
            return null;
        }
    }

    static async verifyRoomPassword(roomId: string, password: string): Promise<boolean> {
        try {
            const results: any = await query(
                'SELECT password FROM rooms WHERE room_id = ? AND is_active = 1',
                [roomId]
            );

            if (results.length === 0) {
                return false;
            }

            const room = results[0];

            // If room has no password, allow access
            if (room.password === null) {
                return true;
            }

            // Verify password
            const isValid = await bcrypt.compare(password, room.password);
            console.log(`[FileService] Password verification for room ${roomId}: ${isValid}`);
            return isValid;
        } catch (error) {
            console.error('[FileService] Error verifying room password:', error);
            return false;
        }
    }

    static async getRoomUsers(roomId: string): Promise<string[]> {
        try {
            const results: any = await query(
                'SELECT username FROM room_users WHERE room_id = ?',
                [roomId]
            );
            return results.map((row: any) => row.username);
        } catch (error) {
            console.error('[FileService] Error getting room users:', error);
            return [];
        }
    }

    static async createFile(
        roomId: string,
        filename: string,
        content: string = '',
        createdBy: string,
        parentDirId: string | null = null,
        fileId?: string
    ): Promise<string> {
        try {
            const finalFileId = fileId || this.generateFileId();
            const filePath = path.join(this.ensureRoomDirectory(roomId), filename);

            console.log(`[FileService] Creating file: ${filename} in room ${roomId} with ID: ${finalFileId}`);

            // Write file to filesystem
            await fs.writeFile(filePath, content);

            // Store in database
            await query(
                `INSERT INTO room_files 
                 (room_id, file_id, filename, file_path, content, file_size, file_type, parent_dir_id, created_by) 
                 VALUES (?, ?, ?, ?, ?, ?, 'file', ?, ?)`,
                [roomId, finalFileId, filename, filePath, content, Buffer.byteLength(content, 'utf8'), parentDirId, createdBy]
            );

            console.log(`[FileService] File created successfully: ${filename} with ID: ${finalFileId}`);
            return finalFileId;
        } catch (error) {
            console.error('[FileService] Error creating file:', error);
            throw error;
        }
    }

    static async createDirectory(
        roomId: string,
        dirname: string,
        createdBy: string,
        parentDirId: string | null = null
    ): Promise<string> {
        try {
            const dirId = this.generateFileId();
            const dirPath = path.join(this.ensureRoomDirectory(roomId), dirname);

            console.log(`[FileService] Creating directory: ${dirname} in room ${roomId}`);

            // Create directory in filesystem
            await fs.mkdir(dirPath, { recursive: true });

            // Store in database
            await query(
                `INSERT INTO room_files 
                 (room_id, file_id, filename, file_path, content, file_size, file_type, parent_dir_id, created_by) 
                 VALUES (?, ?, ?, ?, NULL, 0, 'directory', ?, ?)`,
                [roomId, dirId, dirname, dirPath, parentDirId, createdBy]
            );

            console.log(`[FileService] Directory created successfully: ${dirname} with ID: ${dirId}`);
            return dirId;
        } catch (error) {
            console.error('[FileService] Error creating directory:', error);
            throw error;
        }
    }

    static async updateFileContent(
        roomId: string,
        fileId: string,
        content: string,
        updatedBy: string
    ): Promise<void> {
        try {
            console.log(`[FileService] Updating file content: ${fileId} in room ${roomId}`);

            // First check if file exists
            const file: any = await query(
                'SELECT * FROM room_files WHERE room_id = ? AND file_id = ?',
                [roomId, fileId]
            );

            if (file.length === 0) {
                console.log(`[FileService] File not found, creating new file: ${fileId}`);
                // If file doesn't exist, create it
                await this.createFile(roomId, 'untitled.txt', content, updatedBy, null, fileId);
                return;
            }

            const fileData = file[0];

            // Update file in filesystem
            await fs.writeFile(fileData.file_path, content);

            // Update in database
            await query(
                `UPDATE room_files 
                 SET content = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE room_id = ? AND file_id = ?`,
                [content, Buffer.byteLength(content, 'utf8'), roomId, fileId]
            );

            console.log(`[FileService] File content updated: ${fileId} in room ${roomId}`);
        } catch (error) {
            console.error('[FileService] Error updating file content:', error);
            throw error;
        }
    }

    static async getFileById(roomId: string, fileId: string): Promise<RoomFile | null> {
        try {
            const files: any = await query(
                'SELECT * FROM room_files WHERE room_id = ? AND file_id = ?',
                [roomId, fileId]
            );

            if (files.length === 0) {
                return null;
            }

            return files[0];
        } catch (error) {
            console.error('[FileService] Error getting file by ID:', error);
            return null;
        }
    }

    static async renameFile(
        roomId: string,
        fileId: string,
        newName: string
    ): Promise<void> {
        try {
            const file: any = await query(
                'SELECT * FROM room_files WHERE room_id = ? AND file_id = ?',
                [roomId, fileId]
            );

            if (file.length === 0) {
                throw new Error('File not found');
            }

            const fileData = file[0];
            const newPath = path.join(path.dirname(fileData.file_path), newName);

            // Rename in filesystem
            await fs.rename(fileData.file_path, newPath);

            // Update in database
            await query(
                `UPDATE room_files 
                 SET filename = ?, file_path = ? 
                 WHERE room_id = ? AND file_id = ?`,
                [newName, newPath, roomId, fileId]
            );

            console.log(`[FileService] File renamed: ${fileId} to ${newName} in room ${roomId}`);
        } catch (error) {
            console.error('[FileService] Error renaming file:', error);
            throw error;
        }
    }

    static async deleteFile(roomId: string, fileId: string): Promise<void> {
        try {
            const file: any = await query(
                'SELECT * FROM room_files WHERE room_id = ? AND file_id = ?',
                [roomId, fileId]
            );

            if (file.length === 0) {
                throw new Error('File not found');
            }

            const fileData = file[0];

            // Delete from filesystem
            if (fileData.file_type === 'directory') {
                await fs.rm(fileData.file_path, { recursive: true });
            } else {
                await fs.unlink(fileData.file_path);
            }

            // Delete from database
            await query(
                'DELETE FROM room_files WHERE room_id = ? AND file_id = ?',
                [roomId, fileId]
            );

            console.log(`[FileService] File deleted: ${fileId} from room ${roomId}`);
        } catch (error) {
            console.error('[FileService] Error deleting file:', error);
            throw error;
        }
    }

    static async getFileStructure(roomId: string): Promise<FileStructure[]> {
        try {
            const files: any = await query(
                'SELECT * FROM room_files WHERE room_id = ? ORDER BY file_type, filename',
                [roomId]
            );

            return this.buildFileTree(files);
        } catch (error) {
            console.error('[FileService] Error getting file structure:', error);
            return [];
        }
    }

    private static buildFileTree(files: RoomFile[]): FileStructure[] {
        const fileMap = new Map();
        const rootNodes: FileStructure[] = [];

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
            } else {
                rootNodes.push(fileNode);
            }
        });

        return rootNodes;
    }

    static async getFileContent(roomId: string, fileId: string): Promise<string> {
        try {
            const file: any = await query(
                'SELECT content FROM room_files WHERE room_id = ? AND file_id = ?',
                [roomId, fileId]
            );

            if (file.length === 0) {
                throw new Error('File not found');
            }

            return file[0].content || '';
        } catch (error) {
            console.error('[FileService] Error getting file content:', error);
            throw error;
        }
    }

    static async syncFileStructure(roomId: string, fileStructure: FileStructure[], username: string): Promise<void> {
        try {
            console.log(`[FileService] Syncing file structure for room: ${roomId}`);

            // Validate fileStructure parameter
            if (!fileStructure || !Array.isArray(fileStructure)) {
                console.error('[FileService] Invalid file structure: expected array');
                throw new Error('File structure must be an array');
            }

            console.log(`[FileService] Processing ${fileStructure.length} root nodes`);

            // First, get existing files
            const existingFiles: any = await query(
                'SELECT file_id FROM room_files WHERE room_id = ?',
                [roomId]
            );

            const existingFileIds = new Set(existingFiles.map((file: any) => file.file_id));

            // Recursively process file structure
            const processNode = async (node: FileStructure, parentDirId: string | null = null) => {
                // Validate node structure
                if (!node.id || !node.name || !node.type) {
                    console.warn('[FileService] Skipping invalid node:', node);
                    return;
                }

                if (!existingFileIds.has(node.id)) {
                    console.log(`[FileService] Creating ${node.type}: ${node.name} (${node.id})`);

                    if (node.type === 'file') {
                        await this.createFile(
                            roomId,
                            node.name,
                            node.content || '',
                            username,
                            parentDirId,
                            node.id
                        );
                    } else if (node.type === 'directory') {
                        await this.createDirectory(
                            roomId,
                            node.name,
                            username,
                            parentDirId
                        );

                        // Process children recursively (with validation)
                        if (node.children && Array.isArray(node.children)) {
                            console.log(`[FileService] Processing ${node.children.length} children of ${node.name}`);
                            for (const child of node.children) {
                                await processNode(child, node.id);
                            }
                        }
                    }
                } else {
                    console.log(`[FileService] ${node.type} already exists: ${node.name} (${node.id})`);
                }
            };

            // Process all root nodes
            for (const node of fileStructure) {
                await processNode(node);
            }

            console.log(`[FileService] File structure synced for room: ${roomId}`);
        } catch (error) {
            console.error('[FileService] Error syncing file structure:', error);
            throw error;
        }
    }

    static async saveChatMessage(
        roomId: string,
        messageId: string,
        username: string,
        message: string
    ): Promise<boolean> {
        try {
            console.log(`[FileService] Saving chat message for room: ${roomId}, user: ${username}`);

            const result: any = await query(
                `INSERT INTO room_chats (room_id, message_id, username, message) 
             VALUES (?, ?, ?, ?)`,
                [roomId, messageId, username, message]
            );

            console.log(`[FileService] Chat message saved successfully: ${messageId}`);
            return true;
        } catch (error) {
            console.error('[FileService] Error saving chat message:', error);
            return false;
        }
    }

    static async getRoomChatHistory(roomId: string): Promise<any[]> {
        try {
            console.log(`[FileService] Loading chat history for room: ${roomId}`);

            const messages: any = await query(
                `SELECT message_id as id, username, message, timestamp 
             FROM room_chats 
             WHERE room_id = ? 
             ORDER BY timestamp ASC`,
                [roomId]
            );

            // Format the timestamp for frontend
            const formattedMessages = messages.map((msg: any) => ({
                ...msg,
                timestamp: this.formatChatTimestamp(msg.timestamp)
            }));

            console.log(`[FileService] Loaded ${formattedMessages.length} chat messages for room: ${roomId}`);
            return formattedMessages;
        } catch (error) {
            console.error('[FileService] Error loading chat history:', error);
            return [];
        }
    }

    private static formatChatTimestamp(timestamp: string | Date): string {
        // You can use your existing formatDate function or create a simple formatter
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }

    private static generateFileId(): string {
        return `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}