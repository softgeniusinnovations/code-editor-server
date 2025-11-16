import express, { Response, Request } from "express"
import dotenv from "dotenv"
import http from "http"
import cors from "cors"
import { SocketEvent, SocketId } from "./types/socket"
import { USER_CONNECTION_STATUS, User } from "./types/user"
import { Server } from "socket.io"
import path from "path"
import { FileService } from "./services/fileService"
import { v4 as uuidv4 } from 'uuid'

dotenv.config()

const app = express()

app.use(express.json())
app.use(cors())
app.use(express.static(path.join(__dirname, "public")))

const server = http.createServer(app)
const io = new Server(server, {
    cors: {
        origin: "*",
    },
    maxHttpBufferSize: 1e8,
    pingTimeout: 60000,
})

let userSocketMap: User[] = []

// Function to get all users in a room
function getUsersInRoom(roomId: string): User[] {
    return userSocketMap.filter((user) => user.roomId == roomId)
}

// Function to get room id by socket id
function getRoomId(socketId: SocketId): string | null {
    const roomId = userSocketMap.find(
        (user) => user.socketId === socketId
    )?.roomId

    if (!roomId) {
        console.error("Room ID is undefined for socket ID:", socketId)
        return null
    }
    return roomId
}

function getUserBySocketId(socketId: SocketId): User | null {
    const user = userSocketMap.find((user) => user.socketId === socketId)
    if (!user) {
        console.error("User not found for socket ID:", socketId)
        return null
    }
    return user
}

function generateUniqueUsername(baseUsername: string, existingUsers: User[]): string {
    const existingUsernames = existingUsers.map(user => user.username);
    let uniqueUsername = baseUsername;
    let counter = 1;

    while (existingUsernames.includes(uniqueUsername)) {
        uniqueUsername = `${baseUsername}_${counter}`;
        counter++;
    }

    return uniqueUsername;
}

io.on("connection", (socket) => {
    console.log(`[Socket] User connected: ${socket.id}`)

    // Handle room creation with password
    socket.on(SocketEvent.CREATE_ROOM, async ({ roomName, username, password }) => {
        try {
            console.log(`[Socket] CREATE_ROOM request: "${roomName}" by "${username}"`)

            if (!roomName || !username) {
                throw new Error('Room name and username are required');
            }

            const roomId = uuidv4();
            console.log(`[Socket] Generated room ID: ${roomId}`);

            // Create room in database
            const roomCreated = await FileService.createRoom(roomId, roomName, password);

            if (!roomCreated) {
                throw new Error('Failed to create room in database');
            }

            // Add user to room
            const userAdded = await FileService.addUserToRoom(roomId, username);

            if (!userAdded) {
                throw new Error('Failed to add user to room');
            }

            // Join the room
            const user = {
                username,
                roomId,
                status: USER_CONNECTION_STATUS.ONLINE,
                cursorPosition: 0,
                typing: false,
                socketId: socket.id,
                currentFile: null,
            }
            userSocketMap.push(user)
            socket.join(roomId)

            // Get file structure from database
            const fileStructure = await FileService.getFileStructure(roomId);

            // Send success response
            io.to(socket.id).emit(SocketEvent.ROOM_CREATED, {
                roomId,
                roomName,
                user,
                fileStructure,
                hasPassword: !!password
            })

            console.log(`[Socket] Room created successfully: ${roomId} by ${username}`)
        } catch (error) {
            console.error('[Socket] Error creating room:', error)
            io.to(socket.id).emit(SocketEvent.ERROR, {
                message: 'Failed to create room'
            })
        }
    })

    // Handle room info request
    socket.on(SocketEvent.ROOM_INFO_REQUEST, async ({ roomId }) => {
        try {
            console.log(`[Socket] ROOM_INFO_REQUEST for room: ${roomId}`);
            const roomInfo = await FileService.getRoomInfo(roomId);

            if (!roomInfo) {
                io.to(socket.id).emit(SocketEvent.ERROR, {
                    message: 'Room not found'
                });
                return;
            }

            io.to(socket.id).emit(SocketEvent.ROOM_INFO_RESPONSE, { roomInfo });
        } catch (error) {
            console.error('[Socket] Error getting room info:', error);
            io.to(socket.id).emit(SocketEvent.ERROR, {
                message: 'Failed to get room information'
            });
        }
    });

    // Handle password verification
    socket.on(SocketEvent.CHECK_ROOM_PASSWORD, async ({ roomId, password }) => {
        try {
            console.log(`[Socket] CHECK_ROOM_PASSWORD for room: ${roomId}`);
            const isValid = await FileService.verifyRoomPassword(roomId, password);

            if (isValid) {
                io.to(socket.id).emit(SocketEvent.PASSWORD_VALID, { roomId });
            } else {
                io.to(socket.id).emit(SocketEvent.PASSWORD_INCORRECT, { roomId });
            }
        } catch (error) {
            console.error('[Socket] Error checking password:', error);
            io.to(socket.id).emit(SocketEvent.ERROR, {
                message: 'Failed to verify password'
            });
        }
    });

    // Handle user joining room with password protection
    socket.on(SocketEvent.JOIN_REQUEST, async ({ roomId, username, password, roomName = "Collaborative Room" }) => {
        try {
            console.log(`[Socket] JOIN_REQUEST: "${username}" to room "${roomId}"`)

            if (!roomId || !username) {
                throw new Error('Room ID and username are required');
            }

            // Check if room exists, if not CREATE IT
            const roomExists = await FileService.checkRoomExists(roomId);

            if (!roomExists) {
                console.log(`[Socket] Room does not exist, creating new room: ${roomId}`);
                const roomCreated = await FileService.createRoomIfNotExists(roomId, roomName, password);

                if (!roomCreated) {
                    throw new Error('Failed to create room automatically');
                }
            }

            // Add user to room in database
            const userAdded = await FileService.addUserToRoom(roomId, username);

            if (!userAdded) {
                throw new Error('Failed to add user to room');
            }

            // Check if username already exists in the room and generate unique display name if needed
            const existingUsersInRoom = getUsersInRoom(roomId);
            const finalUsername = generateUniqueUsername(username, existingUsersInRoom);

            const user = {
                username: finalUsername,
                roomId,
                status: USER_CONNECTION_STATUS.ONLINE,
                cursorPosition: 0,
                typing: false,
                socketId: socket.id,
                currentFile: null,
            }
            userSocketMap.push(user)
            socket.join(roomId)

            // Get file structure from database
            const fileStructure = await FileService.getFileStructure(roomId);
            const users = getUsersInRoom(roomId)

            // Notify others
            socket.broadcast.to(roomId).emit(SocketEvent.USER_JOINED, { user })

            // Send acceptance to user
            io.to(socket.id).emit(SocketEvent.JOIN_ACCEPTED, {
                user,
                users,
                fileStructure,
                roomName: roomName
            })

            console.log(`[Socket] User ${finalUsername} joined room successfully: ${roomId}`)
        } catch (error) {
            console.error('[Socket] Error joining room:', error)
            io.to(socket.id).emit(SocketEvent.ERROR, {
                message: 'Failed to join room'
            })
        }
    })

    // Broadcast to all clients in the room
    socket.on(SocketEvent.SYNC_FILE_STRUCTURE, ({ fileStructure, openFiles, activeFile, socketId }) => {
        const roomId = getRoomId(socket.id)
        if (!roomId) return

        FileService.syncFileStructure(roomId, fileStructure.children || [], getUserBySocketId(socket.id)?.username || 'unknown')
            .then(() => {
                io.to(roomId).emit(SocketEvent.SYNC_FILE_STRUCTURE, {
                    fileStructure,
                    openFiles,
                    activeFile,
                })
            })
            .catch(error => {
                console.error('Error syncing file structure:', error)
            })
    })

    socket.on(SocketEvent.LOAD_FILE_STRUCTURE, async () => {
        try {
            const roomId = getRoomId(socket.id)
            if (!roomId) return

            console.log(`[Socket] Loading file structure for room: ${roomId}`)

            const fileStructure = await FileService.getFileStructure(roomId)

            io.to(socket.id).emit(SocketEvent.FILE_STRUCTURE_LOADED, {
                fileStructure: {
                    id: 'root',
                    name: 'Root',
                    type: 'directory',
                    children: fileStructure,
                    isOpen: true
                }
            })

            console.log(`[Socket] File structure loaded for room: ${roomId}`)
        } catch (error) {
            console.error('[Socket] Error loading file structure:', error)
            io.to(socket.id).emit(SocketEvent.ERROR, {
                message: 'Failed to load file structure'
            })
        }
    })

    // Handle file creation - SYNC TO ALL AND STORE IN DB
    socket.on(SocketEvent.FILE_CREATED, async ({ parentDirId, newFile }) => {
        try {
            const roomId = getRoomId(socket.id)
            if (!roomId) return

            const user = getUserBySocketId(socket.id)
            if (!user) return

            console.log(`[Socket] Creating file: ${newFile.name} in room ${roomId}`)

            // Store in database
            const fileId = await FileService.createFile(
                roomId,
                newFile.name,
                newFile.content || '',
                user.username,
                parentDirId,
                newFile.id
            );

            newFile.id = fileId;

            // Automatic sync to other users (like old code)
            socket.broadcast
                .to(roomId)
                .emit(SocketEvent.FILE_CREATED, { parentDirId, newFile })

            console.log(`[Socket] File created and synced: ${newFile.name} in room ${roomId}`)
        } catch (error) {
            console.error('[Socket] Error creating file:', error)
            io.to(socket.id).emit(SocketEvent.ERROR, {
                message: 'Failed to create file'
            })
        }
    })

    // Handle directory creation - SYNC TO ALL AND STORE IN DB
    socket.on(SocketEvent.DIRECTORY_CREATED, async ({ parentDirId, newDirectory }) => {
        try {
            const roomId = getRoomId(socket.id)
            if (!roomId) return

            const user = getUserBySocketId(socket.id)
            if (!user) return

            console.log(`[Socket] Creating directory: ${newDirectory.name} in room ${roomId}`)

            // Store in database
            const dirId = await FileService.createDirectory(
                roomId,
                newDirectory.name,
                user.username,
                parentDirId
            );

            newDirectory.id = dirId;

            // Automatic sync to other users (like old code)
            socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_CREATED, {
                parentDirId,
                newDirectory,
            })

            console.log(`[Socket] Directory created and synced: ${newDirectory.name} in room ${roomId}`)
        } catch (error) {
            console.error('[Socket] Error creating directory:', error)
            io.to(socket.id).emit(SocketEvent.ERROR, {
                message: 'Failed to create directory'
            })
        }
    })

    // Handle file content updates - SYNC TO ALL AND STORE IN DB
    socket.on(SocketEvent.FILE_UPDATED, async ({ fileId, newContent }) => {
        try {
            const roomId = getRoomId(socket.id)
            if (!roomId) return

            const user = getUserBySocketId(socket.id)
            if (!user) return

            console.log(`[Socket] Updating file: ${fileId} in room ${roomId}`)

            // Store in database
            await FileService.updateFileContent(roomId, fileId, newContent, user.username);

            // Automatic sync to other users (like old code)
            socket.broadcast.to(roomId).emit(SocketEvent.FILE_UPDATED, {
                fileId,
                newContent,
            })

            console.log(`[Socket] File updated and synced: ${fileId} in room ${roomId}`)
        } catch (error) {
            console.error('[Socket] Error updating file:', error)
            io.to(socket.id).emit(SocketEvent.ERROR, {
                message: 'Failed to update file'
            })
        }
    })

    // Handle file renaming - SYNC TO ALL AND STORE IN DB
    socket.on(SocketEvent.FILE_RENAMED, async ({ fileId, newName }) => {
        try {
            const roomId = getRoomId(socket.id)
            if (!roomId) return

            console.log(`[Socket] Renaming file: ${fileId} to ${newName} in room ${roomId}`)

            // Store in database
            await FileService.renameFile(roomId, fileId, newName);

            // Automatic sync to other users (like old code)
            socket.broadcast.to(roomId).emit(SocketEvent.FILE_RENAMED, {
                fileId,
                newName,
            })

            console.log(`[Socket] File renamed and synced: ${fileId} to ${newName} in room ${roomId}`)
        } catch (error) {
            console.error('[Socket] Error renaming file:', error)
            io.to(socket.id).emit(SocketEvent.ERROR, {
                message: 'Failed to rename file'
            })
        }
    })

    // Handle file deletion - SYNC TO ALL AND STORE IN DB
    socket.on(SocketEvent.FILE_DELETED, async ({ fileId }) => {
        try {
            const roomId = getRoomId(socket.id)
            if (!roomId) return

            console.log(`[Socket] Deleting file: ${fileId} from room ${roomId}`)

            // Delete from database
            await FileService.deleteFile(roomId, fileId);

            // Automatic sync to other users (like old code)
            socket.broadcast.to(roomId).emit(SocketEvent.FILE_DELETED, { fileId })

            console.log(`[Socket] File deleted and synced: ${fileId} from room ${roomId}`)
        } catch (error) {
            console.error('[Socket] Error deleting file:', error)
            io.to(socket.id).emit(SocketEvent.ERROR, {
                message: 'Failed to delete file'
            })
        }
    })

    // Handle directory renaming - SYNC TO ALL AND STORE IN DB
    socket.on(SocketEvent.DIRECTORY_RENAMED, async ({ dirId, newName }) => {
        try {
            const roomId = getRoomId(socket.id)
            if (!roomId) return

            console.log(`[Socket] Renaming directory: ${dirId} to ${newName} in room ${roomId}`)

            // Store in database
            await FileService.renameFile(roomId, dirId, newName);

            // Automatic sync to other users (like old code)
            socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_RENAMED, {
                dirId,
                newName,
            })

            console.log(`[Socket] Directory renamed and synced: ${dirId} to ${newName} in room ${roomId}`)
        } catch (error) {
            console.error('[Socket] Error renaming directory:', error)
            io.to(socket.id).emit(SocketEvent.ERROR, {
                message: 'Failed to rename directory'
            })
        }
    })

    // Handle directory deletion - SYNC TO ALL AND STORE IN DB
    socket.on(SocketEvent.DIRECTORY_DELETED, async ({ dirId }) => {
        try {
            const roomId = getRoomId(socket.id)
            if (!roomId) return

            console.log(`[Socket] Deleting directory: ${dirId} from room ${roomId}`)

            // Delete from database
            await FileService.deleteFile(roomId, dirId);

            // Automatic sync to other users (like old code)
            socket.broadcast
                .to(roomId)
                .emit(SocketEvent.DIRECTORY_DELETED, { dirId })

            console.log(`[Socket] Directory deleted and synced: ${dirId} from room ${roomId}`)
        } catch (error) {
            console.error('[Socket] Error deleting directory:', error)
            io.to(socket.id).emit(SocketEvent.ERROR, {
                message: 'Failed to delete directory'
            })
        }
    })

    // Load file content from database
    socket.on(SocketEvent.LOAD_FILE_CONTENT, async ({ fileId }) => {
        try {
            const roomId = getRoomId(socket.id)
            if (!roomId) return

            console.log(`[Socket] Loading file content: ${fileId} from room ${roomId}`)

            const content = await FileService.getFileContent(roomId, fileId);

            io.to(socket.id).emit(SocketEvent.FILE_CONTENT_LOADED, {
                fileId,
                content
            })

            console.log(`[Socket] File content loaded from DB: ${fileId} from room ${roomId}`)
        } catch (error) {
            console.error('[Socket] Error loading file content:', error)
            io.to(socket.id).emit(SocketEvent.ERROR, {
                message: 'Failed to load file content'
            })
        }
    })

    // REST OF THE CODE REMAINS THE SAME (user status, chat, cursor, drawing, etc.)
    // ... [Keep all the existing user status, chat, cursor, and drawing handlers from your old code]

    socket.on(SocketEvent.USER_OFFLINE, ({ socketId }) => {
        userSocketMap = userSocketMap.map((user) => {
            if (user.socketId === socketId) {
                return { ...user, status: USER_CONNECTION_STATUS.OFFLINE }
            }
            return user
        })
        const roomId = getRoomId(socketId)
        if (!roomId) return
        socket.broadcast.to(roomId).emit(SocketEvent.USER_OFFLINE, { socketId })
    })

    socket.on(SocketEvent.USER_ONLINE, ({ socketId }) => {
        userSocketMap = userSocketMap.map((user) => {
            if (user.socketId === socketId) {
                return { ...user, status: USER_CONNECTION_STATUS.ONLINE }
            }
            return user
        })
        const roomId = getRoomId(socketId)
        if (!roomId) return
        socket.broadcast.to(roomId).emit(SocketEvent.USER_ONLINE, { socketId })
    })

    // Handle chat actions
    socket.on(SocketEvent.SEND_MESSAGE, ({ message }) => {
        const roomId = getRoomId(socket.id)
        if (!roomId) return
        socket.broadcast
            .to(roomId)
            .emit(SocketEvent.RECEIVE_MESSAGE, { message })
    })

    // Handle cursor position and selection
    socket.on(SocketEvent.TYPING_START, ({ cursorPosition, selectionStart, selectionEnd }) => {
        userSocketMap = userSocketMap.map((user) => {
            if (user.socketId === socket.id) {
                return {
                    ...user,
                    typing: true,
                    cursorPosition,
                    selectionStart,
                    selectionEnd
                }
            }
            return user
        })
        const user = getUserBySocketId(socket.id)
        if (!user) return
        const roomId = user.roomId
        socket.broadcast.to(roomId).emit(SocketEvent.TYPING_START, { user })
    })

    socket.on(SocketEvent.TYPING_PAUSE, () => {
        userSocketMap = userSocketMap.map((user) => {
            if (user.socketId === socket.id) {
                return { ...user, typing: false }
            }
            return user
        })
        const user = getUserBySocketId(socket.id)
        if (!user) return
        const roomId = user.roomId
        socket.broadcast.to(roomId).emit(SocketEvent.TYPING_PAUSE, { user })
    })

    // Handle cursor movement without typing
    socket.on(SocketEvent.CURSOR_MOVE, ({ cursorPosition, selectionStart, selectionEnd }) => {
        userSocketMap = userSocketMap.map((user) => {
            if (user.socketId === socket.id) {
                return {
                    ...user,
                    cursorPosition,
                    selectionStart,
                    selectionEnd
                }
            }
            return user
        })
        const user = getUserBySocketId(socket.id)
        if (!user) return
        const roomId = user.roomId
        socket.broadcast.to(roomId).emit(SocketEvent.CURSOR_MOVE, { user })
    })

    socket.on(SocketEvent.REQUEST_DRAWING, () => {
        const roomId = getRoomId(socket.id)
        if (!roomId) return
        socket.broadcast
            .to(roomId)
            .emit(SocketEvent.REQUEST_DRAWING, { socketId: socket.id })
    })

    socket.on(SocketEvent.SYNC_DRAWING, ({ drawingData, socketId }) => {
        socket.broadcast
            .to(socketId)
            .emit(SocketEvent.SYNC_DRAWING, { drawingData })
    })

    socket.on(SocketEvent.DRAWING_UPDATE, ({ snapshot }) => {
        const roomId = getRoomId(socket.id)
        if (!roomId) return
        socket.broadcast.to(roomId).emit(SocketEvent.DRAWING_UPDATE, {
            snapshot,
        })
    })

    socket.on("disconnecting", async () => {
        const user = getUserBySocketId(socket.id)
        if (!user) return
        const roomId = user.roomId
        socket.broadcast
            .to(roomId)
            .emit(SocketEvent.USER_DISCONNECTED, { user })
        userSocketMap = userSocketMap.filter((u) => u.socketId !== socket.id)
        socket.leave(roomId)
        console.log(`[Socket] User disconnected: ${socket.id} from room: ${roomId}`)
    })
})

const PORT = process.env.PORT || 3000

app.get("/", (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"))
})

server.listen(PORT, () => {
    console.log(`[Server] Listening on port ${PORT}`)
    console.log(`[Server] File storage path: ${process.env.FILE_STORAGE_PATH || './file_storage'}`)
    console.log(`[Server] Database: ${process.env.DB_NAME || 'code_editor'}`)
})