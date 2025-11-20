import { query } from '../db';
import { RoomEditRequest, RoomEditResponse, RoomInfo } from '../types/room';
import bcrypt from 'bcryptjs';

export class RoomService {

    /**
     * Check if user is the owner of the room
     */
    static async isRoomOwner(roomId: string, username: string): Promise<boolean> {
        try {
            const results: any = await query(
                'SELECT owner_name FROM rooms WHERE room_id = ?', 
                [roomId]
            );

            if (results.length === 0) {
                return false;
            }

            return results[0].owner_name === username;
        } catch (error) {
            console.error('[RoomService] Error checking room owner:', error);
            return false;
        }
    }

    /**
     * Get complete room information
     */
    static async getRoomInfo(roomId: string): Promise<RoomInfo | null> {
        try {
            const results: any = await query(
                `SELECT r.room_id, r.room_name, r.owner_name, r.password, r.is_active, r.is_delete, r.created_at, 
                    COUNT(ru.id) as user_count
             FROM rooms r
             LEFT JOIN room_users ru ON r.room_id = ru.room_id
             WHERE r.room_id = ? AND (r.is_delete = 0 OR r.is_delete IS NULL)
             GROUP BY r.room_id`,
                [roomId]
            );

            if (results.length === 0) {
                return null;
            }

            const room = results[0];

            // Debug log to see what's being returned
            console.log(`[RoomService] Raw room data from DB:`, {
                room_id: room.room_id,
                room_name: room.room_name,
                is_active: room.is_active,
                is_active_type: typeof room.is_active,
                is_delete: room.is_delete
            });

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
        } catch (error) {
            console.error('[RoomService] Error getting room info:', error);
            return null;
        }
    }

    /**
     * Edit room information (only by owner)
     */
    static async editRoom(request: RoomEditRequest, changedBy: string): Promise<RoomEditResponse> {
        try {
            console.log(`[RoomService] Editing room: ${request.roomId} by ${changedBy}`, JSON.stringify(request, null, 2));

            // Verify room exists and get current info
            const currentRoom: any = await query(
                'SELECT * FROM rooms WHERE room_id = ?',
                [request.roomId]
            );

            if (currentRoom.length === 0) {
                console.log(`[RoomService] Room not found: ${request.roomId}`);
                return {
                    success: false,
                    message: 'Room not found'
                };
            }

            const currentRoomData = currentRoom[0];
            console.log(`[RoomService] Current room data:`, currentRoomData);

            // Verify user is the owner
            if (currentRoomData.owner_name !== changedBy) {
                console.log(`[RoomService] User ${changedBy} is not owner. Owner is: ${currentRoomData.owner_name}`);
                return {
                    success: false,
                    message: 'Only room owner can edit room information'
                };
            }

            const updates: string[] = [];
            const params: any[] = [];

            // Handle room name change
            if (request.roomName && request.roomName !== currentRoomData.room_name) {
                console.log(`[RoomService] Updating room_name from "${currentRoomData.room_name}" to "${request.roomName}"`);
                updates.push('room_name = ?');
                params.push(request.roomName);
            }

            // Handle password change
            if (request.password !== undefined) {
                if (request.password === null) {
                    console.log(`[RoomService] Removing password`);
                    updates.push('password = NULL');
                } else if (request.password.trim() !== '') {
                    console.log(`[RoomService] Setting new password`);
                    const hashedPassword = await bcrypt.hash(request.password, 10);
                    updates.push('password = ?');
                    params.push(hashedPassword);
                }
            }

            // Handle active status change
            if (request.isActive !== undefined) {
                const newActiveStatus = Boolean(request.isActive);
                const currentActiveStatus = Boolean(currentRoomData.is_active);
                console.log(`[RoomService] Updating is_active from ${currentActiveStatus} to ${newActiveStatus}`);
                updates.push('is_active = ?');
                params.push(newActiveStatus ? 1 : 0);
            }

            // Handle delete status change
            if (request.isDelete !== undefined) {
                const newDeleteStatus = Boolean(request.isDelete);
                const currentDeleteStatus = Boolean(currentRoomData.is_delete);
                console.log(`[RoomService] Updating is_delete from ${currentDeleteStatus} to ${newDeleteStatus}`);
                updates.push('is_delete = ?');
                params.push(newDeleteStatus ? 1 : 0);
            }

            // If no changes, return early
            if (updates.length === 0) {
                console.log(`[RoomService] No changes to make`);
                return {
                    success: true,
                    message: 'No changes made'
                };
            }

            // Update room in database
            params.push(request.roomId);
            const updateQuery = `UPDATE rooms SET ${updates.join(', ')} WHERE room_id = ?`;

            console.log(`[RoomService] Executing query: ${updateQuery} with params:`, params);

            const result: any = await query(updateQuery, params);
            console.log(`[RoomService] Update result:`, result);

            // Get updated room info
            const updatedRoomInfo = await this.getRoomInfo(request.roomId);
            console.log(`[RoomService] Updated room info:`, updatedRoomInfo);

            console.log(`[RoomService] Room ${request.roomId} updated successfully`);

            if (updatedRoomInfo) {
                return {
                    success: true,
                    message: 'Room updated successfully',
                    roomInfo: updatedRoomInfo
                };
            } else {
                return {
                    success: true,
                    message: 'Room updated successfully'
                };
            }

        } catch (error) {
            console.error('[RoomService] Error editing room:', error);
            return {
                success: false,
                message: 'Failed to update room'
            };
        }
    }

    /**
     * Remove password from room
     */
    static async removePassword(roomId: string, username: string, reason?: string): Promise<RoomEditResponse> {
        return await this.editRoom({
            roomId,
            password: null,
            reason
        }, username);
    }

    /**
     * Toggle active status
     */
    static async toggleActiveStatus(roomId: string, username: string, isActive: boolean, reason?: string): Promise<RoomEditResponse> {
        return await this.editRoom({
            roomId,
            isActive,
            reason
        }, username);
    }

    /**
     * Toggle delete status (soft delete)
     */
    static async toggleDeleteStatus(roomId: string, username: string, isDelete: boolean, reason?: string): Promise<RoomEditResponse> {
        return await this.editRoom({
            roomId,
            isDelete,
            reason
        }, username);
    }

    /**
 * Activate a room
 */
    static async activateRoom(roomId: string, username: string, reason?: string): Promise<RoomEditResponse> {
        try {
            console.log(`[RoomService] Activating room: ${roomId} by ${username}`);

            const editRequest: RoomEditRequest = {
                roomId,
                isActive: true,
                reason: reason || "Room activated by owner"
            };

            return await this.editRoom(editRequest, username);
        } catch (error) {
            console.error('[RoomService] Error activating room:', error);
            return {
                success: false,
                message: 'Failed to activate room'
            };
        }
    }

    /**
     * Deactivate a room
     */
    static async deactivateRoom(roomId: string, username: string, reason?: string): Promise<RoomEditResponse> {
        try {
            console.log(`[RoomService] Deactivating room: ${roomId} by ${username}`);

            const editRequest: RoomEditRequest = {
                roomId,
                isActive: false,
                reason: reason || "Room deactivated by owner"
            };

            return await this.editRoom(editRequest, username);
        } catch (error) {
            console.error('[RoomService] Error deactivating room:', error);
            return {
                success: false,
                message: 'Failed to deactivate room'
            };
        }
    }
}