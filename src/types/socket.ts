import { Socket } from "socket.io"

type SocketId = string

enum SocketEvent {
    CREATE_ROOM = "create-room",
    ROOM_CREATED = "room-created",
    JOIN_REQUEST = "join-request",
    JOIN_ACCEPTED = "join-accepted",
    USER_JOINED = "user-joined",
    USER_DISCONNECTED = "user-disconnected",
    SYNC_FILE_STRUCTURE = "sync-file-structure",
    DIRECTORY_CREATED = "directory-created",
    DIRECTORY_UPDATED = "directory-updated",
    DIRECTORY_RENAMED = "directory-renamed",
    DIRECTORY_DELETED = "directory-deleted",
    FILE_CREATED = "file-created",
    FILE_UPDATED = "file-updated",
    FILE_RENAMED = "file-renamed",
    FILE_DELETED = "file-deleted",
    LOAD_FILE_CONTENT = "load-file-content",
    FILE_CONTENT_LOADED = "file-content-loaded",
    USER_OFFLINE = "offline",
    USER_ONLINE = "online",
    SEND_MESSAGE = "send-message",
    RECEIVE_MESSAGE = "receive-message",
    TYPING_START = "typing-start",
    TYPING_PAUSE = "typing-pause",
    CURSOR_MOVE = "cursor-move",
    USERNAME_EXISTS = "username-exists",
    REQUEST_DRAWING = "request-drawing",
    SYNC_DRAWING = "sync-drawing",
    DRAWING_UPDATE = "drawing-update",
    ERROR = "error",
    PASSWORD_REQUIRED = "password-required",
    PASSWORD_INCORRECT = "password-incorrect",
    ROOM_INFO_REQUEST = "room-info-request",
    ROOM_INFO_RESPONSE = "room-info-response",
    CHECK_ROOM_PASSWORD = "check-room-password",
    PASSWORD_VALID = "password-valid",
    CHAT_HISTORY_REQUEST = "chat-history-request",
    CHAT_HISTORY_RESPONSE = "chat-history-response",
    CHAT_MESSAGE_SENT = "chat-message-sent",
    FILE_STRUCTURE_LOADED = "file-structure-loaded",
    LOAD_FILE_STRUCTURE = "load-file-structure",
    LOAD_CHAT_HISTORY = 'load_chat_history',
    CHAT_HISTORY_LOADED = 'chat_history_loaded',

    EDIT_ROOM_REQUEST = 'EDIT_ROOM_REQUEST',
    EDIT_ROOM_RESPONSE = 'EDIT_ROOM_RESPONSE',
    ROOM_OWNER_CHECK = 'ROOM_OWNER_CHECK',
    ROOM_OWNER_RESPONSE = 'ROOM_OWNER_RESPONSE',
    ROOM_UPDATED = 'ROOM_UPDATED',

    USER_BANNED = 'USER_BANNED',
    ROOM_INACTIVE = 'ROOM_INACTIVE',
    ROOM_DELETED = 'ROOM_DELETED',
    BAN_USER = 'BAN_USER',
    UNBAN_USER = 'UNBAN_USER',
    JOIN_PENDING = 'JOIN_PENDING',

    GET_PENDING_USERS = 'GET_PENDING_USERS',
    PENDING_USERS_LIST = 'PENDING_USERS_LIST',
    APPROVE_USER = 'APPROVE_USER',
    REJECT_USER = 'REJECT_USER',
    USER_APPROVED = 'USER_APPROVED',
    JOIN_REJECTED = 'JOIN_REJECTED',

    GET_ROOM_USERS = "GET_ROOM_USERS",
    ROOM_USERS_LIST = "ROOM_USERS_LIST",
    UPDATE_USER_STATUS = "UPDATE_USER_STATUS",
    USER_STATUS_UPDATED = "USER_STATUS_UPDATED",
    USER_BANNED_STATUS = "USER_BANNED_STATUS",

}

interface SocketContext {
    socket: Socket
}

export { SocketEvent, SocketContext, SocketId }