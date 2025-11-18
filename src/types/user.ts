export interface User {
    username: string;
    roomId: string;
    status: USER_CONNECTION_STATUS;
    cursorPosition: number;
    typing: boolean;
    socketId: string;
    currentFile: string | null;
    selectionStart?: number;
    selectionEnd?: number;
    photo?: string | null;
}

export enum USER_CONNECTION_STATUS {
    ONLINE = 'online',
    OFFLINE = 'offline'
}

export interface FileStructure {
    id: string;
    name: string;
    type: 'file' | 'directory';
    children?: FileStructure[];
    content?: string;
    parentDirId?: string;
}

export interface Room {
    room_id: string;
    room_name: string;
    password: string | null;
    created_at: string;
    is_active: boolean;
}

export interface RoomFile {
    id: number;
    room_id: string;
    file_id: string;
    filename: string;
    file_path: string;
    content: string;
    file_size: number;
    file_type: 'file' | 'directory';
    parent_dir_id: string | null;
    created_by: string;
    created_at: string;
    updated_at: string;
}

export interface RoomInfo {
    room_id: string;
    room_name: string;
    has_password: boolean;
    created_at: string;
    user_count: number;
}