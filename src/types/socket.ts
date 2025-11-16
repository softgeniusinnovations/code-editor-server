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
    LOAD_CHAT_HISTORY = 'LOAD_CHAT_HISTORY',
    CHAT_HISTORY_LOADED = 'CHAT_HISTORY_LOADED',
}

interface SocketContext {
    socket: Socket
}

export { SocketEvent, SocketContext, SocketId }