export interface RoomEditRequest {
    roomId: string;
    roomName?: string;
    password?: string | null; 
    isActive?: boolean;
    isDelete?: boolean;
    reason?: string;
}

export interface RoomEditResponse {
    success: boolean;
    message: string;
    roomInfo?: RoomInfo; 
}

export interface RoomInfo {
    room_id: string;
    room_name: string;
    owner_name: string;
    has_password: boolean;
    is_active: boolean;
    is_delete: boolean;
    created_at: string;
    user_count: number;
}