import express from "express";
import passport from "passport";
import { createServer } from "http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { sessionMiddleware, pool } from "./sessionMiddleware.js";
import bcrypt from "bcrypt";
import { Strategy as LocalStrategy } from "passport-local";

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {},
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "../client/build")));
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());

const saltRounds = 10;

passport.use(
  new LocalStrategy(async (username, password, cb) => {
    try {
      const result = await pool.query(
        "SELECT * FROM users WHERE username = $1",
        [username]
      );

      if (result.rows.length === 0) {
        return cb(null, false, { message: "User not found" });
      }

      const user = result.rows[0];
      const storedHashedPassword = user.password;

      const isValid = await bcrypt.compare(password, storedHashedPassword);
      return isValid
        ? cb(null, user)
        : cb(null, false, { message: "Invalid credentials" });
    } catch (err) {
      console.error("Error during authentication:", err);
      return cb(err);
    }
  })
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return result.rows.length ? done(null, result.rows[0]) : done(null, false);
  } catch (err) {
    return done(err);
  }
});

app.post("/register", async (req, res) => {
  const { username, password } = req.body;

  try {
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    if (existingUser.rows.length > 0) {
      return res
        .status(400)
        .json({ success: false, message: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const newUser = await pool.query(
      "INSERT INTO users (username, password) VALUES ($1, $2) RETURNING *",
      [username, hashedPassword]
    );

    req.login(newUser.rows[0], (err) => {
      if (err) {
        return res.status(500).json({ success: false, message: "Login error" });
      }
      res.json({
        success: true,
        message: "Registered & logged in",
        user: newUser.rows[0],
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user) => {
    if (err)
      return res.status(500).json({ success: false, message: "Server error" });
    if (!user)
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });

    req.login(user, (err) => {
      if (err)
        return res
          .status(500)
          .json({ success: false, message: "Login failed" });
      res.json({ success: true, message: "Logged in successfully", user });
    });
  })(req, res, next);
});

app.post("/logout", (req, res) => {
  req.logout((err) => {
    if (err)
      return res.status(500).json({ success: false, message: "Logout error" });
    res.json({ success: true, message: "Logged out successfully" });
  });
});

app.get("/auth-status", (req, res) => {
  res.json({
    authenticated: req.isAuthenticated(),
    user: req.isAuthenticated() ? req.user : null,
  });
});

app.get("/users", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  
  try {
    const result = await pool.query(
      "SELECT id, username FROM users WHERE id != $1",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/messages/:friendId", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const friendId = parseInt(req.params.friendId, 10);
  const userId = req.user.id;

  if (isNaN(friendId)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid friend ID" });
  }

  try {
    const result = await pool.query(
      `SELECT sender_id, receiver_id, text, created_at 
       FROM messages 
       WHERE (sender_id = $1 AND receiver_id = $2)
          OR (sender_id = $2 AND receiver_id = $1)
       ORDER BY created_at ASC`,
      [userId, friendId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, () => {
    passport.initialize()(socket.request, {}, () => {
      passport.session()(socket.request, {}, () => {
        if (socket.request.isAuthenticated && socket.request.isAuthenticated()) {
          return next();
        }
        next(new Error("Unauthorized"));
      });
    });
  });
});

const userSockets = new Map(); // Store userId -> socketId mapping

io.on("connection", async (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // Ensure the user is authenticated
  if (!socket.request.isAuthenticated()) {
    console.log("❌ Unauthorized user attempted connection.");
    socket.disconnect();
    return;
  }

  const userId = socket.request.user.id;
  userSockets.set(userId, socket.id); // ✅ Store user socket ID
  console.log(`✅ User ${userId} connected with socket ID ${socket.id}`);

  // Send chat history to the user
  try {
    const result = await pool.query(
      `SELECT sender_id, receiver_id, text, created_at 
       FROM messages 
       WHERE sender_id = $1 OR receiver_id = $1
       ORDER BY created_at DESC 
       LIMIT 50`,
      [userId]
    );
    socket.emit("chat history", result.rows.reverse());
  } catch (error) {
    console.error("❌ Error fetching chat history:", error);
  }

  // Handle chat messages
  socket.on("chat message", async ({ text, receiverId }, callback) => {
    const userId = socket.request.user.id;
    console.log("📩 Message received:", { senderId: userId, receiverId, text });
  
    if (!text || !receiverId) {
      return callback("Invalid message format.");
    }
  
    try {
      // Insert into database
      const newMessage = await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, text) 
         VALUES ($1, $2, $3) RETURNING *`,
        [userId, receiverId, text]
      );
  
      const savedMessage = newMessage.rows[0];
  
      // Send only to the recipient (not broadcasting to all sockets)
      const recipientSocketId = userSockets.get(receiverId);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("chat message", savedMessage);
      }
  
      // Only send back to the sender if needed
      io.to(socket.id).emit("chat message", savedMessage);
  
      callback();
    } catch (error) {
      console.error("❌ Error saving message:", error);
      callback("Error sending message.");
    }
  });
  

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`🔌 User ${userId} disconnected.`);
    userSockets.delete(userId); // ✅ Remove user from active sockets
  });
});


app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/build/index.html"));
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
