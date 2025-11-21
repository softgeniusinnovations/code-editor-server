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
import multer from "multer"
import { RoomService } from './services/roomService';
import { query } from './db';

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

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, "../uploads"))
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname)
        const unique = Date.now() + "-" + Math.round(Math.random() * 1e9)
        cb(null, unique + ext)
    }
})

const upload = multer({ storage })


// ------------ USER PHOTO UPLOAD -------------
app.post("/upload-photo", upload.single("photo"), async (req: Request, res: Response) => {
    try {
        const { roomId, username } = req.body

        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" })
        }

        const filePath = `/uploads/${req.file.filename}`

        const updatedUser = await FileService.updateUserPhoto(roomId, username, filePath);

        if (!updatedUser) {
            return res.status(500).json({ error: "Failed to update photo" });
        }

        io.to(roomId).emit("USER_PHOTO_UPDATED", updatedUser);

        res.json({
            success: true,
            photo: updatedUser.photo
        });

    } catch (error) {
        console.error("ERROR /upload-photo", error)
        res.status(500).json({ error: "Server error" })
    }
})

app.use("/uploads", express.static(path.join(__dirname, "../uploads")))

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

            // Check if room already exists and is deleted/inactive
            const roomStatus = await FileService.checkRoomStatus(roomId);
            if (roomStatus.isDeleted || !roomStatus.isActive) {
                io.to(socket.id).emit(SocketEvent.ERROR, {
                    message: 'Cannot create room with this code. The room has been deleted or is inactive.'
                });
                return;
            }

            // Create room in database
            const roomCreated = await FileService.createRoom(roomId, roomName, password, username);

            if (!roomCreated) {
                io.to(socket.id).emit(SocketEvent.ERROR, {
                    message: 'Cannot create room: a room with this ID may be deleted or already exist.'
                });
                return;
            }

            // Add user to room with active status (room owner)
            const userAdded = await FileService.addUserToRoom(roomId, username, true); // true for is_active

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
                isActive: true,
                isOwner: true
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

    socket.on(SocketEvent.JOIN_REQUEST, async ({ roomId, username, password, roomName = "Collaborative Room" }) => {
        try {
            console.log(`[Socket] JOIN_REQUEST: "${username}" to room "${roomId}"`);

            if (!roomId || !username) {
                throw new Error('Room ID and username are required');
            }

            const roomExists = await FileService.checkRoomExists(roomId);
            let isActiveUser = false;

            if (!roomExists) {
                console.log(`[Socket] Room ${roomId} does not exist, creating it...`);

                // Don't check room status for new rooms - create it directly
                const roomCreated = await FileService.createRoom(roomId, roomName, password, username);

                if (!roomCreated) {
                    throw new Error('Failed to create room');
                }
                console.log(`[Socket] Room ${roomId} created successfully`);
                // Room creator (owner) should be active
                isActiveUser = true;
            } else {
                console.log(`[Socket] Room ${roomId} already exists`);

                // Only check room status for EXISTING rooms
                const roomStatus = await FileService.checkRoomStatus(roomId);

                // Check if user is the room owner
                const isRoomOwner = await FileService.isUserRoomOwner(roomId, username);

                // Room owners can always join, even if room is inactive or deleted
                if (!isRoomOwner) {
                    if (roomStatus.isDeleted) {
                        io.to(socket.id).emit(SocketEvent.ERROR, {
                            message: 'This room has been deleted and is no longer available.'
                        });
                        return;
                    }

                    if (!roomStatus.isActive) {
                        io.to(socket.id).emit(SocketEvent.ERROR, {
                            message: 'This room is currently inactive.'
                        });
                        return;
                    }
                } else {
                    console.log(`[Socket] Room owner ${username} joining, bypassing room status checks`);

                    // Reactivate the room if owner is joining an inactive room
                    if (!roomStatus.isActive || roomStatus.isDeleted) {
                        console.log(`[Socket] Reactivating room ${roomId} as owner is joining`);
                        await FileService.reactivateRoom(roomId);
                    }
                }

                // Check if user is banned
                const banInfo = await FileService.isUserBanned(roomId, username);
                if (banInfo.banned) {
                    io.to(socket.id).emit(SocketEvent.ERROR, {
                        message: `You are banned from this room. Reason: ${banInfo.reason || 'No reason provided'}`
                    });
                    return;
                }


                // Get room info to check password status
                const roomInfo = await FileService.getRoomInfo(roomId);

                // Check if user is the room owner
                const isRoomOwnerCheck = roomInfo && roomInfo.owner_name === username;

                if (isRoomOwnerCheck) {
                    // Room owner always has automatic access
                    isActiveUser = true;
                    console.log(`[Socket] User ${username} is room owner - granting automatic access`);
                } else {
                    // Check if user already exists in room and their current status
                    const userExistsInRoom = await FileService.isUserInRoom(roomId, username);

                    if (userExistsInRoom) {
                        // User already exists - check their current active status
                        const userActiveStatus = await FileService.getUserActiveStatus(roomId, username);

                        if (userActiveStatus) {
                            // User was previously approved - grant immediate access
                            isActiveUser = true;
                            console.log(`[Socket] User ${username} was previously approved - granting immediate access`);
                        } else {
                            // User exists but not approved - check if room has password
                            if (roomInfo && roomInfo.has_password) {
                                // Room has password - user still needs approval
                                isActiveUser = false;
                                console.log(`[Socket] User ${username} exists but not approved - needs approval`);
                            } else {
                                // Room has no password - auto-approve existing user
                                isActiveUser = true;
                                await FileService.updateUserActiveStatus(roomId, username, true);
                                console.log(`[Socket] Room has no password - auto-approving existing user ${username}`);
                            }
                        }
                    } else {
                        // New user - first time joining
                        if (roomInfo && roomInfo.has_password) {
                            // Room has password - user needs approval
                            isActiveUser = false;
                            console.log(`[Socket] New user ${username} in password-protected room - needs approval`);
                        } else {
                            // Room has no password - grant immediate access
                            isActiveUser = true;
                            console.log(`[Socket] New user ${username} in open room - granting immediate access`);
                        }
                    }
                }
            }

            // Always add/update user to room (insert into database)
            const userExistsInRoom = await FileService.isUserInRoom(roomId, username);

            if (!userExistsInRoom) {
                const userAdded = await FileService.addUserToRoom(roomId, username, isActiveUser);
                if (!userAdded) {
                    throw new Error('Failed to add user to room');
                }
                console.log(`[Socket] User ${username} added to room ${roomId} with active status: ${isActiveUser}`);
            } else {
                console.log(`[Socket] Username "${username}" already exists → active status: ${isActiveUser}`);
                // Only update if we're changing the status (like auto-approving)
                if (isActiveUser) {
                    await FileService.updateUserActiveStatus(roomId, username, isActiveUser);
                }
            }

            // If user is not active, show pending message
            if (!isActiveUser) {
                io.to(socket.id).emit(SocketEvent.JOIN_PENDING, {
                    roomId,
                    message: 'Your join request is pending approval. Please wait for room owner to approve your request.'
                });
                return;
            }

            // User is active - proceed with joining
            const existingUsersInRoom = getUsersInRoom(roomId);
            const finalUsername = generateUniqueUsername(username, existingUsersInRoom);
            const userPhoto = await FileService.getUserPhoto(roomId, username);

            const user = {
                username: finalUsername,
                roomId,
                status: USER_CONNECTION_STATUS.ONLINE,
                cursorPosition: 0,
                typing: false,
                socketId: socket.id,
                currentFile: null,
                photo: userPhoto || undefined,
                isActive: true,
                isOwner: await FileService.isUserRoomOwner(roomId, username)
            };

            userSocketMap.push(user);
            socket.join(roomId);

            const fileStructure = await FileService.getFileStructure(roomId);
            const users = getUsersInRoom(roomId);

            socket.broadcast.to(roomId).emit(SocketEvent.USER_JOINED, { user });

            io.to(socket.id).emit(SocketEvent.JOIN_ACCEPTED, {
                user,
                users,
                fileStructure,
                roomName
            });

            console.log(`[Socket] User ${finalUsername} joined room: ${roomId} with active status: ${isActiveUser}`);
        } catch (error) {
            console.error('[Socket] Error joining room:', error);
            io.to(socket.id).emit(SocketEvent.ERROR, { message: 'Failed to join room' });
        }
    });

    socket.on(SocketEvent.GET_PENDING_USERS, async ({ roomId }) => {
        try {
            const user = getUserBySocketId(socket.id);
            if (!user) return;

            // Verify user is room owner
            const isOwner = await RoomService.isRoomOwner(roomId, user.username);
            if (!isOwner) {
                io.to(socket.id).emit(SocketEvent.ERROR, { message: 'Only room owner can view pending users' });
                return;
            }

            const pendingUsers = await FileService.getPendingUsers(roomId);
            io.to(socket.id).emit(SocketEvent.PENDING_USERS_LIST, { pendingUsers });
        } catch (error) {
            console.error('[Socket] Error getting pending users:', error);
            io.to(socket.id).emit(SocketEvent.ERROR, { message: 'Failed to get pending users' });
        }
    });

    socket.on(SocketEvent.APPROVE_USER, async ({ roomId, username }) => {
        try {
            const user = getUserBySocketId(socket.id);
            if (!user) return;

            // Verify user is room owner
            const isOwner = await RoomService.isRoomOwner(roomId, user.username);
            if (!isOwner) {
                io.to(socket.id).emit(SocketEvent.ERROR, { message: 'Only room owner can approve users' });
                return;
            }

            const approved = await FileService.approveUser(roomId, username);
            if (approved) {
                io.to(roomId).emit(SocketEvent.USER_APPROVED, { username });
                const pendingUserSocket = userSocketMap.find(u => u.username === username && u.roomId === roomId);
                if (pendingUserSocket) {
                    io.to(pendingUserSocket.socketId).emit(SocketEvent.JOIN_ACCEPTED, {
                        user: pendingUserSocket,
                        users: getUsersInRoom(roomId),
                        fileStructure: await FileService.getFileStructure(roomId),
                        roomName: (await FileService.getRoomInfo(roomId))?.room_name || 'Collaborative Room'
                    });
                }
            }
        } catch (error) {
            console.error('[Socket] Error approving user:', error);
            io.to(socket.id).emit(SocketEvent.ERROR, { message: 'Failed to approve user' });
        }
    });

    socket.on(SocketEvent.REJECT_USER, async ({ roomId, username }) => {
        try {
            const user = getUserBySocketId(socket.id);
            if (!user) return;

            const isOwner = await RoomService.isRoomOwner(roomId, user.username);
            if (!isOwner) {
                io.to(socket.id).emit(SocketEvent.ERROR, { message: 'Only room owner can reject users' });
                return;
            }

            const rejected = await FileService.rejectUser(roomId, username);
            if (rejected) {
                const rejectedUserSocket = userSocketMap.find(u => u.username === username && u.roomId === roomId);
                if (rejectedUserSocket) {
                    io.to(rejectedUserSocket.socketId).emit(SocketEvent.JOIN_REJECTED, {
                        message: 'Your join request was rejected by the room owner.'
                    });
                    userSocketMap = userSocketMap.filter(u => u.socketId !== rejectedUserSocket.socketId);
                }
            }
        } catch (error) {
            console.error('[Socket] Error rejecting user:', error);
            io.to(socket.id).emit(SocketEvent.ERROR, { message: 'Failed to reject user' });
        }
    });

    socket.on("GET_ROOM_USERS", async ({ roomId }) => {
        try {
            const user = getUserBySocketId(socket.id);
            if (!user) return;

            console.log(`[Socket] GET_ROOM_USERS for room: ${roomId}`);

            // Get all users in the room from database
            const roomUsers: any = await query(
                `SELECT ru.username, ru.photo, ru.is_active, ru.is_banned, 
                    (SELECT owner_name FROM rooms WHERE room_id = ?) as owner_name
             FROM room_users ru
             WHERE ru.room_id = ? 
             ORDER BY ru.is_banned, ru.is_active, ru.username`,
                [roomId, roomId]
            );

            const formattedUsers = roomUsers.map((user: any) => ({
                username: user.username,
                photo: user.photo,
                is_active: Boolean(user.is_active),
                is_banned: Boolean(user.is_banned),
                is_owner: user.username === user.owner_name
            }));

            console.log(`[Socket] Found ${formattedUsers.length} users in room ${roomId}`);

            io.to(socket.id).emit("ROOM_USERS_LIST", { users: formattedUsers });
        } catch (error) {
            console.error('[Socket] Error getting room users:', error);
            io.to(socket.id).emit("ERROR", { message: 'Failed to get room users' });
        }
    });

    // Update user active status
    socket.on(SocketEvent.UPDATE_USER_STATUS, async ({ roomId, username, is_active }) => {
        try {
            const user = getUserBySocketId(socket.id);
            if (!user) return;

            // Verify user is room owner
            const isOwner = await FileService.isUserRoomOwner(roomId, user.username);
            if (!isOwner) {
                io.to(socket.id).emit(SocketEvent.ERROR, { message: 'Only room owner can update user status' });
                return;
            }

            const updated = await FileService.updateUserActiveStatus(roomId, username, is_active);
            if (updated) {
                io.to(roomId).emit(SocketEvent.USER_STATUS_UPDATED, { username, is_active });
            }
        } catch (error) {
            console.error('[Socket] Error updating user status:', error);
            io.to(socket.id).emit(SocketEvent.ERROR, { message: 'Failed to update user status' });
        }
    });

    // Ban user
    socket.on(SocketEvent.BAN_USER, async ({ roomId, username, reason }) => {
        try {
            const user = getUserBySocketId(socket.id);
            if (!user) return;

            // Verify user is room owner
            const isOwner = await FileService.isUserRoomOwner(roomId, user.username);
            if (!isOwner) {
                io.to(socket.id).emit(SocketEvent.ERROR, { message: 'Only room owner can ban users' });
                return;
            }

            const banned = await FileService.banUser(roomId, username, reason);
            if (banned) {
                io.to(roomId).emit(SocketEvent.USER_BANNED_STATUS, { username, is_banned: true });

                // Notify the banned user
                const bannedUserSocket = userSocketMap.find(u => u.username === username && u.roomId === roomId);
                if (bannedUserSocket) {
                    io.to(bannedUserSocket.socketId).emit(SocketEvent.ERROR, {
                        message: `You have been banned from the room. Reason: ${reason || 'No reason provided'}`
                    });
                }
            }
        } catch (error) {
            console.error('[Socket] Error banning user:', error);
            io.to(socket.id).emit(SocketEvent.ERROR, { message: 'Failed to ban user' });
        }
    });

    // Unban user
    socket.on(SocketEvent.UNBAN_USER, async ({ roomId, username }) => {
        try {
            const user = getUserBySocketId(socket.id);
            if (!user) return;

            // Verify user is room owner
            const isOwner = await FileService.isUserRoomOwner(roomId, user.username);
            if (!isOwner) {
                io.to(socket.id).emit(SocketEvent.ERROR, { message: 'Only room owner can unban users' });
                return;
            }

            const unbanned = await FileService.unbanUser(roomId, username);
            if (unbanned) {
                io.to(roomId).emit(SocketEvent.USER_BANNED_STATUS, { username, is_banned: false });
            }
        } catch (error) {
            console.error('[Socket] Error unbanning user:', error);
            io.to(socket.id).emit(SocketEvent.ERROR, { message: 'Failed to unban user' });
        }
    });


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
    socket.on(SocketEvent.SEND_MESSAGE, async ({ message }) => {
        try {
            const roomId = getRoomId(socket.id)
            if (!roomId) return

            console.log(`[Socket] Saving chat message in room: ${roomId}`)

            // Save message to database
            const saved = await FileService.saveChatMessage(
                roomId,
                message.id,
                message.username,
                message.message
            );

            if (!saved) {
                console.error('[Socket] Failed to save chat message to database');
            }

            // Broadcast to other users in the room
            socket.broadcast
                .to(roomId)
                .emit(SocketEvent.RECEIVE_MESSAGE, { message })

            console.log(`[Socket] Chat message saved and broadcasted: ${message.id}`)
        } catch (error) {
            console.error('[Socket] Error handling chat message:', error)
        }
    })

    socket.on(SocketEvent.LOAD_CHAT_HISTORY, async () => {
        try {
            const roomId = getRoomId(socket.id)
            if (!roomId) return

            console.log(`[Socket] Loading chat history for room: ${roomId}`)

            const chatHistory = await FileService.getRoomChatHistory(roomId);

            io.to(socket.id).emit(SocketEvent.CHAT_HISTORY_LOADED, {
                messages: chatHistory
            })

            console.log(`[Socket] Chat history loaded for room: ${roomId}, messages: ${chatHistory.length}`)
        } catch (error) {
            console.error('[Socket] Error loading chat history:', error)
            io.to(socket.id).emit(SocketEvent.ERROR, {
                message: 'Failed to load chat history'
            })
        }
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

    socket.on("USER_PHOTO_UPDATED", async ({ username, photo }) => {
        try {
            const roomId = getRoomId(socket.id)
            if (!roomId) return

            console.log(`[Socket] User photo updated: ${username} in room ${roomId}`)

            userSocketMap = userSocketMap.map(user => {
                if (user.username === username && user.roomId === roomId) {
                    return {
                        ...user,
                        photo: photo || undefined
                    }
                }
                return user
            })

            await FileService.updateUserPhoto(roomId, username, photo);

            io.to(roomId).emit("USER_PHOTO_UPDATED", {
                username,
                photo: photo || undefined
            })

            console.log(`[Socket] Photo update broadcasted for user: ${username}`)
        } catch (error) {
            console.error('[Socket] Error updating user photo:', error)
        }
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

    socket.on(SocketEvent.ROOM_OWNER_CHECK, async ({ roomId }) => {
        try {
            const user = getUserBySocketId(socket.id);
            if (!user) {
                io.to(socket.id).emit(SocketEvent.ERROR, { message: 'User not found' });
                return;
            }

            const isOwner = await RoomService.isRoomOwner(roomId, user.username);

            io.to(socket.id).emit(SocketEvent.ROOM_OWNER_RESPONSE, {
                isOwner,
                roomId
            });

            console.log(`[Socket] Room owner check for ${user.username} in ${roomId}: ${isOwner}`);
        } catch (error) {
            console.error('[Socket] Error checking room owner:', error);
            io.to(socket.id).emit(SocketEvent.ERROR, { message: 'Failed to check room ownership' });
        }
    });

    socket.on(SocketEvent.EDIT_ROOM_REQUEST, async (editRequest) => {
        try {
            const user = getUserBySocketId(socket.id);
            if (!user) {
                io.to(socket.id).emit(SocketEvent.EDIT_ROOM_RESPONSE, {
                    success: false,
                    message: 'User not found'
                });
                return;
            }

            console.log(`[Socket] EDIT_ROOM_REQUEST for room: ${editRequest.roomId} by ${user.username}`);

            const response = await RoomService.editRoom(editRequest, user.username);

            if (response.success) {
                const updatedRoomInfo = await RoomService.getRoomInfo(editRequest.roomId);

                io.to(editRequest.roomId).emit(SocketEvent.EDIT_ROOM_RESPONSE, {
                    ...response,
                    roomInfo: updatedRoomInfo,
                    updatedBy: user.username
                });

                io.to(editRequest.roomId).emit(SocketEvent.ROOM_INFO_RESPONSE, {
                    roomInfo: updatedRoomInfo
                });

                if (editRequest.isDelete === true) {
                    io.to(editRequest.roomId).emit(SocketEvent.ERROR, {
                        message: `Room has been deleted by the owner`
                    });
                }
            } else {
                io.to(socket.id).emit(SocketEvent.EDIT_ROOM_RESPONSE, response);
            }

            console.log(`[Socket] Room edit completed for ${editRequest.roomId}: ${response.success}`);
        } catch (error) {
            console.error('[Socket] Error editing room:', error);
            io.to(socket.id).emit(SocketEvent.EDIT_ROOM_RESPONSE, {
                success: false,
                message: 'Failed to update room'
            });
        }
    });

    // WebRTC Signaling events
    socket.on('WEBRTC_OFFER', async (data: { offer: any; roomId: string; targetUser: string }) => {
        try {
            const user = getUserBySocketId(socket.id);
            if (!user) return;

            if (data.targetUser === 'all') {
                // Broadcast to all other users in the room
                socket.broadcast.to(data.roomId).emit('WEBRTC_OFFER', {
                    offer: data.offer,
                    fromUser: user.username
                });
            } else {
                // Send to specific user
                const targetUser = userSocketMap.find(u =>
                    u.username === data.targetUser && u.roomId === data.roomId
                );
                if (targetUser) {
                    io.to(targetUser.socketId).emit('WEBRTC_OFFER', {
                        offer: data.offer,
                        fromUser: user.username
                    });
                }
            }
        } catch (error) {
            console.error('[Socket] Error handling WebRTC offer:', error);
        }
    });

    socket.on('WEBRTC_ANSWER', async (data: { answer: any; roomId: string; targetUser: string }) => {
        try {
            const user = getUserBySocketId(socket.id);
            if (!user) return;

            const targetUser = userSocketMap.find(u =>
                u.username === data.targetUser && u.roomId === data.roomId
            );
            if (targetUser) {
                io.to(targetUser.socketId).emit('WEBRTC_ANSWER', {
                    answer: data.answer,
                    fromUser: user.username
                });
            }
        } catch (error) {
            console.error('[Socket] Error handling WebRTC answer:', error);
        }
    });

    socket.on('WEBRTC_ICE_CANDIDATE', async (data: { candidate: any; roomId: string; targetUser: string }) => {
        try {
            const user = getUserBySocketId(socket.id);
            if (!user) return;

            const targetUser = userSocketMap.find(u =>
                u.username === data.targetUser && u.roomId === data.roomId
            );
            if (targetUser) {
                io.to(targetUser.socketId).emit('WEBRTC_ICE_CANDIDATE', {
                    candidate: data.candidate,
                    fromUser: user.username
                });
            }
        } catch (error) {
            console.error('[Socket] Error handling ICE candidate:', error);
        }
    });

    socket.on('USER_AUDIO_TOGGLED', (data: { roomId: string; username: string; isAudioEnabled: boolean }) => {
        // Broadcast to all users in the room
        socket.broadcast.to(data.roomId).emit('USER_AUDIO_TOGGLED', {
            username: data.username,
            isAudioEnabled: data.isAudioEnabled
        });
    });


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