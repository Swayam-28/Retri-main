// server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" }
});

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:8000";
const nodemailer = require("nodemailer");

// SMTP Configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.titan.email",
  port: process.env.SMTP_PORT || 465,
  secure: true, 
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); 
app.use(express.static(__dirname)); 

// Schemas
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  phone: String,
  password: String
});

const itemSchema = new mongoose.Schema({
  title: String,
  category: String,
  description: String,
  location: String,
  type: String,  
  date: String,
  time: String,
  contactInfo: String,
  userId: String,
  image: String,
  notifiedMatches: { type: [String], default: [] }
});

const messageSchema = new mongoose.Schema({
  roomId: String,
  senderId: String,
  receiverId: String,
  message: String,
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});

const chatRoomSchema = new mongoose.Schema({
  roomId: { type: String, unique: true },
  users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  itemTitle1: String,
  itemTitle2: String,
  createdAt: { type: Date, default: Date.now }
});

const foundItemLogSchema = new mongoose.Schema({
  title1: String,
  title2: String,
  description1: String,
  description2: String,
  location1: String,
  location2: String,
  contact1: String,
  contact2: String,
  user1Id: String,
  user2Id: String,
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const Item = mongoose.model("Item", itemSchema);
const Message = mongoose.model("Message", messageSchema);
const ChatRoom = mongoose.model("ChatRoom", chatRoomSchema);
const FoundItemLog = mongoose.model("FoundItemLog", foundItemLogSchema);

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB Atlas Connected");
    syncAiService();
  })
  .catch(err => console.error(err));

async function syncAiService() {
  try {
    console.log("Checking AI service sync status...");
    const items = await Item.find({});
    if (items.length === 0) return;

    let aiStatus;
    try {
      const res = await axios.get(`${AI_SERVICE_URL}/status`);
      aiStatus = res.data.indexed_ids || [];
    } catch (apiErr) {
      console.log("AI Service not yet awake. Retrying sync in 15s...");
      setTimeout(syncAiService, 15000);
      return;
    }

    const missingItems = items.filter(item => !aiStatus.includes(item._id.toString()));

    if (missingItems.length > 0) {
      console.log(`Found ${missingItems.length} items missing. Re-syncing...`);
      for (const item of missingItems) {
        try {
          await axios.post(`${AI_SERVICE_URL}/add_item`, {
            itemId: item._id.toString(),
            title: item.title,
            description: item.description,
            imageUrl: item.image
          });
          await new Promise(r => setTimeout(r, 1500)); 
        } catch (err) {
          console.error(`Failed to sync item ${item._id}:`, err.message);
        }
      }
      console.log("AI Sync complete!");
    } else {
      console.log("AI service is fully synced.");
    }
  } catch (err) {
    console.error("Error during AI sync loop:", err.message);
  }
}

// Password validation
function isValidPassword(password) {
  const minLength = 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[@$!%*?&]/.test(password);
  return password.length >= minLength && hasUpper && hasLower && hasNumber && hasSpecial;
}

// Routes
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!isValidPassword(password)) {
      return res.json({
        success: false,
        message: "Password must be at least 8 characters long and include uppercase, lowercase, number, and special character."
      });
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const user = new User({ name, email, phone, password: hashedPassword });
    await user.save();
    res.json({ success: true, user });
  } catch (err) {
    if (err.code === 11000) {
      res.json({ success: false, message: "Email already registered" });
    } else {
      res.json({ success: false, message: "Registration failed" });
    }
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.json({ success: false, message: "Invalid email or password" });
    }
    res.json({ success: true, user });
  } catch (err) {
    res.json({ success: false, message: "Login failed" });
  }
});

app.get("/api/items", async (req, res) => {
  try {
    const { type } = req.query;
    if (!type) return res.json({ success: false, message: "Type required" });
    const items = await Item.find({ type });
    res.json({ success: true, items });
  } catch (err) {
    res.json({ success: false, message: "Failed to fetch items" });
  }
});

app.post("/api/items", async (req, res) => {
  try {
    const item = new Item(req.body);
    await item.save();
    try {
      await axios.post(`${AI_SERVICE_URL}/add_item`, {
        itemId: item._id.toString(),
        title: item.title,
        description: item.description,
        imageUrl: item.image
      });
    } catch (aiError) {
      console.error(`AI indexing failed:`, aiError.message);
    }
    res.json({ success: true, item });
  } catch (err) {
    res.json({ success: false, message: "Failed to save item" });
  }
});

app.get("/api/items/:id", async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.json({ success: false, message: "Item not found" });
    res.json({ success: true, item });
  } catch (err) {
    res.json({ success: false, message: "Failed to fetch item" });
  }
});

app.get("/api/items/:id/matches", async (req, res) => {
  try {
    const { id } = req.params;
    const originalItem = await Item.findById(id);
    if (!originalItem) return res.json({ success: false, message: "Item not found" });

    const oppositeType = originalItem.type === 'lost' ? 'found' : 'lost';
    const response = await axios.get(`${AI_SERVICE_URL}/find_matches`, { params: { item_id: id } });
    const matches = response.data.matches || [];

    if (matches.length === 0) return res.json({ success: true, items: [] });

    const matchIds = matches.map(m => m.itemId);
    const potentialMatchItems = await Item.find({
      '_id': { $in: matchIds },
      'type': oppositeType,
      'userId': { $ne: originalItem.userId }
    });

    const finalItems = potentialMatchItems.map(item => {
      const matchInfo = matches.find(m => m.itemId === item._id.toString());
      const cosineSimilarity = 1 - (matchInfo.distance / 2);
      const matchScore = Math.round(Math.max(0, (cosineSimilarity - 0.4) / 0.6) * 100);
      return { ...item.toObject(), matchScore };
    });

    let originalItemNeedsSave = false;
    for (const item of finalItems) {
      if (item.matchScore >= 80 && !(originalItem.notifiedMatches || []).includes(item._id.toString())) {
        const originalUser = await User.findById(originalItem.userId);
        const matchedUser = await User.findById(item.userId);

        if (originalUser && matchedUser) {
          const backendUrl = req.protocol + '://' + req.get('host');
          const confirmationLink = `${backendUrl}/api/items/confirm-match/${originalItem._id}/${item._id}`;
          const lostId = originalItem.type === 'lost' ? originalItem._id : item._id;
          const foundId = originalItem.type === 'found' ? originalItem._id : item._id;
          const chatRoomId = `match_${lostId}_${foundId}`;
          const chatRoomLink = `${backendUrl}/?page=messages&room=${chatRoomId}`;

          const mailHtml = `
            <h2>Great News!</h2>
            <p>Potential match found with ${item.matchScore}% similarity.</p>
            <p><strong>Your Item:</strong> ${originalItem.title}</p>
            <p><strong>Matched Item:</strong> ${item.title}</p>
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
              <a href="${confirmationLink}" style="padding: 10px; background: #28a745; color: #fff; text-decoration: none;">Confirm & Remove</a>
              <a href="${chatRoomLink}" style="padding: 10px; background: #4F46E5; color: #fff; text-decoration: none;">Open Chat</a>
            </div>`;

          await transporter.sendMail({
            from: `"Retrievix Team" <${process.env.SMTP_USER}>`,
            to: [originalUser.email, matchedUser.email],
            subject: 'Potential Match Found!',
            html: mailHtml
          });

          const existingRoom = await ChatRoom.findOne({ roomId: chatRoomId });
          if (!existingRoom) {
            await new ChatRoom({
              roomId: chatRoomId,
              users: [originalUser._id, matchedUser._id],
              itemTitle1: originalItem.title,
              itemTitle2: item.title
            }).save();
          }

          if (!originalItem.notifiedMatches) originalItem.notifiedMatches = [];
          originalItem.notifiedMatches.push(item._id.toString());
          originalItemNeedsSave = true;
          await Item.findByIdAndUpdate(item._id, { $addToSet: { notifiedMatches: originalItem._id.toString() } });
        }
      }
    }

    if (originalItemNeedsSave) await originalItem.save();
    res.json({ success: true, items: finalItems });
  } catch (err) {
    res.json({ success: false, message: "Match fetch failed" });
  }
});

app.get("/api/items/confirm-match/:id1/:id2", async (req, res) => {
  try {
    const { id1, id2 } = req.params;
    const item1 = await Item.findById(id1);
    const item2 = await Item.findById(id2);

    if (item1 || item2) {
      await new FoundItemLog({
        title1: item1 ? item1.title : 'Deleted',
        title2: item2 ? item2.title : 'Deleted',
        description1: item1 ? item1.description : '',
        description2: item2 ? item2.description : '',
        location1: item1 ? item1.location : '',
        location2: item2 ? item2.location : '',
        contact1: item1 ? item1.contactInfo : '',
        contact2: item2 ? item2.contactInfo : '',
        user1Id: item1 ? item1.userId : '',
        user2Id: item2 ? item2.userId : ''
      }).save();
    }

    let lostId = id1, foundId = id2;
    if (item1 && item1.type === 'found') { lostId = id2; foundId = id1; }
    else if (item2 && item2.type === 'lost') { lostId = id2; foundId = id1; }

    const deleted1 = await Item.findByIdAndDelete(id1);
    const deleted2 = await Item.findByIdAndDelete(id2);
    const chatRoomId = `match_${lostId}_${foundId}`;
    await ChatRoom.findOneAndDelete({ roomId: chatRoomId });
    await Message.deleteMany({ roomId: chatRoomId });

    const message = (deleted1 || deleted2) ? "Match Confirmed!" : "Already Processed";
    res.send(`<html><body style="text-align:center; padding:50px; font-family:sans-serif;"><h1>${message}</h1><a href="/">Back to Home</a></body></html>`);
  } catch (err) {
    res.status(500).send("Error occurred.");
  }
});

app.get("/api/items/search", async (req, res) => {
  try {
    const { query, type, userId } = req.query;
    if (!query) return res.json({ success: false, message: "Query required" });
    const searchRegex = new RegExp(query, 'i');
    const searchQuery = { $or: [{ title: searchRegex }, { description: searchRegex }] };
    if (type) searchQuery.type = type;
    if (userId) searchQuery.userId = { $ne: userId };
    const items = await Item.find(searchQuery);
    res.json({ success: true, items });
  } catch (err) {
    res.json({ success: false, message: "Search failed" });
  }
});

app.delete("/api/items/:id", async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item || item.userId !== req.body.userId) {
      return res.json({ success: false, message: "Unauthorized" });
    }
    await Item.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

app.get("/api/messages/:roomId", async (req, res) => {
  try {
    const messages = await Message.find({ roomId: req.params.roomId }).sort({ timestamp: 1 });
    res.json({ success: true, messages });
  } catch (err) {
    res.json({ success: false });
  }
});

app.get("/api/chats/user/:userId", async (req, res) => {
  try {
    const rooms = await ChatRoom.find({ users: req.params.userId }).populate('users', 'name email');
    res.json({ success: true, rooms });
  } catch (err) {
    res.json({ success: false });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    const logs = await FoundItemLog.find({}).sort({ timestamp: -1 });
    res.json({ success: true, logs });
  } catch (err) {
    res.json({ success: false });
  }
});

app.get("/api/users/:id/profile", async (req, res) => {
  try {
    const user = await User.findById(req.params.id, 'name');
    if (!user) return res.json({ success: false });
    const items = await Item.find({ userId: req.params.id });
    res.json({ success: true, user, items });
  } catch (err) {
    res.json({ success: false });
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket.IO
io.on("connection", (socket) => {
  socket.on("join_room", (roomId) => socket.join(roomId));
  socket.on("send_message", async (data) => {
    try {
      const newMsg = new Message(data);
      await newMsg.save();
      io.to(data.roomId).emit("receive_message", newMsg);
    } catch (err) {
      console.error(err);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));