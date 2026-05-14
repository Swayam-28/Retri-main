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
  host: process.env.SMTP_HOST || "smtpout.secureserver.net",
  port: process.env.SMTP_PORT || 465,
  secure: true, 
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true })); 
app.use(express.static(__dirname)); 

// --- Mongoose Schemas ---

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

// --- MongoDB Connection & AI Sync ---

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

function isValidPassword(password) {
  const minLength = 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[@$!%*?&]/.test(password);
  return password.length >= minLength && hasUpper && hasLower && hasNumber && hasSpecial;
}

// --- Routes ---

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!isValidPassword(password)) {
      return res.json({ success: false, message: "Invalid Password format." });
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const user = new User({ name, email, phone, password: hashedPassword });
    await user.save();
    res.json({ success: true, user });
  } catch (err) {
    res.json({ success: false, message: "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.json({ success: false, message: "Invalid credentials" });
    }
    res.json({ success: true, user });
  } catch (err) {
    res.json({ success: false, message: "Login failed" });
  }
});

app.get("/api/items", async (req, res) => {
  try {
    const { type } = req.query;
    const items = await Item.find(type ? { type } : {});
    res.json({ success: true, items });
  } catch (err) {
    res.json({ success: false });
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
    res.json({ success: false });
  }
});

app.delete("/api/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deletedItem = await Item.findByIdAndDelete(id);
    if (!deletedItem) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }

    try {
      await axios.delete(`${AI_SERVICE_URL}/delete_item/${id}`);
    } catch (aiError) {
      console.error(`AI deletion failed:`, aiError.message);
    }
    
    res.json({ success: true, message: "Item deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/items/confirm-match/:id1/:id2", async (req, res) => {
  const { id1, id2 } = req.params;
  try {
    // STEP 1: Fetch both items BEFORE deleting (so we have type, title, etc.)
    const item1 = await Item.findById(id1).catch(() => null);
    const item2 = await Item.findById(id2).catch(() => null);

    if (!item1 && !item2) {
      return res.send(`
        <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 80px;">
          <div style="font-size: 60px;">✅</div>
          <h1 style="color: #28a745;">Already Confirmed!</h1>
          <p style="color: #555;">These items have already been removed from our database.</p>
          <a href="/" style="display: inline-block; margin-top: 20px; padding: 12px 30px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Return to Dashboard</a>
        </div>
      `);
    }

    // STEP 2: Log to FoundItemLog (non-critical)
    try {
      const user1 = item1 ? await User.findById(item1.userId).catch(() => null) : null;
      const user2 = item2 ? await User.findById(item2.userId).catch(() => null) : null;
      await new FoundItemLog({
        title1: item1?.title, title2: item2?.title,
        description1: item1?.description, description2: item2?.description,
        location1: item1?.location, location2: item2?.location,
        contact1: user1?.email, contact2: user2?.email,
        user1Id: item1?.userId, user2Id: item2?.userId
      }).save();
      console.log(`[MATCH CONFIRMED] Logged: "${item1?.title}" <-> "${item2?.title}"`);
    } catch (logErr) {
      console.error("[MATCH CONFIRMED] Logging failed (non-critical):", logErr.message);
    }

    // STEP 3: Delete both items from MongoDB
    await Item.findByIdAndDelete(id1);
    await Item.findByIdAndDelete(id2);
    console.log(`[MATCH CONFIRMED] Items ${id1} and ${id2} deleted from database.`);

    // STEP 4: Remove from AI index (non-critical)
    try {
      await axios.delete(`${AI_SERVICE_URL}/delete_item/${id1}`);
      await axios.delete(`${AI_SERVICE_URL}/delete_item/${id2}`);
      console.log(`[MATCH CONFIRMED] Items removed from AI index.`);
    } catch (aiError) {
      console.error(`[MATCH CONFIRMED] AI deletion failed (non-critical):`, aiError.message);
    }

    // STEP 5: Delete chat room and all messages using regex to find any room containing either item ID
    try {
      const deletedRooms = await ChatRoom.find({
        $or: [
          { roomId: { $regex: id1 } },
          { roomId: { $regex: id2 } }
        ]
      });

      for (const room of deletedRooms) {
        const deletedMsgs = await Message.deleteMany({ roomId: room.roomId });
        await ChatRoom.findByIdAndDelete(room._id);
        console.log(`[MATCH CONFIRMED] Chat room "${room.roomId}" and ${deletedMsgs.deletedCount} messages deleted.`);
      }

      if (deletedRooms.length === 0) {
        console.log(`[MATCH CONFIRMED] No chat room found for items ${id1} / ${id2} (may not have been created yet).`);
      }
    } catch (chatErr) {
      console.error("[MATCH CONFIRMED] Chat cleanup failed (non-critical):", chatErr.message);
    }

    // STEP 6: Return success page
    res.send(`
      <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 80px;">
        <div style="font-size: 60px;">🎉</div>
        <h1 style="color: #28a745; font-size: 32px;">Match Confirmed!</h1>
        <p style="color: #555; max-width: 400px; margin: 0 auto 30px;">Both items have been successfully claimed and permanently removed from our database. The chat room has also been cleared.</p>
        <p style="color: #888; font-size: 14px;">Thank you for using Retrievix!</p>
        <a href="/" style="display: inline-block; margin-top: 20px; padding: 12px 30px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Return to Dashboard</a>
      </div>
    `);
  } catch (err) {
    console.error("[MATCH CONFIRMED] Critical Error:", err);
    res.status(500).send(`
      <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
        <h1 style="color: #dc3545;">Oops!</h1>
        <p>There was an unexpected issue. Please try again.</p>
        <a href="/" style="color: #4F46E5;">Return to Home</a>
      </div>
    `);
  }
});

// --- THE BULLETPROOF MATCH ROUTE ---
app.get("/api/items/:id/matches", async (req, res) => {
  try {
    const { id } = req.params;
    const originalItem = await Item.findById(id);
    if (!originalItem) return res.json({ success: false, message: "Item not found" });

    const oppositeType = originalItem.type === 'lost' ? 'found' : 'lost';
    
    // 1. Get matches from AI Service
    let matches = [];
    try {
      const response = await axios.get(`${AI_SERVICE_URL}/find_matches`, { params: { item_id: id } });
      matches = response.data.matches || [];
    } catch (apiErr) {
      console.log(`[DEBUG] AI match fetch failed for ${id} (possibly not indexed yet):`, apiErr.message);
      return res.json({ success: true, items: [] });
    }

    console.log(`[DEBUG] AI returned ${matches.length} raw matches for item ${id}`);

    if (matches.length === 0) return res.json({ success: true, items: [] });

    const matchIds = matches.map(m => m.itemId);
    
    // 2. Filter matches by Type and UserID
    const potentialMatchItems = await Item.find({
      '_id': { $in: matchIds },
      'type': oppositeType,
      'userId': { $ne: originalItem.userId }
    });

    console.log(`[DEBUG] Potential matches after type/user filter: ${potentialMatchItems.length}`);

    // 3. Map items to include scores SAFELY
    const finalItems = potentialMatchItems.map(item => {
      const matchInfo = matches.find(m => m.itemId === item._id.toString());
      
      // Safety Check: If matchInfo is missing, default to 0 to prevent crash
      const rawScore = (matchInfo && matchInfo.score) ? matchInfo.score : 0;
      const matchScore = Math.round(rawScore * 100);
      
      return { ...item.toObject(), matchScore };
    });

    // 4. Handle Notifications (Wrapped in a separate try/catch)
    try {
      let originalItemNeedsSave = false;
      for (const item of finalItems) {
        if (item.matchScore >= 80 && !(originalItem.notifiedMatches || []).includes(item._id.toString())) {
          const originalUser = await User.findById(originalItem.userId);
          const matchedUser = await User.findById(item.userId);

          if (originalUser && matchedUser) {
            const backendUrl = req.protocol + '://' + req.get('host');
            const lostId = originalItem.type === 'lost' ? originalItem._id : item._id;
            const foundId = originalItem.type === 'found' ? originalItem._id : item._id;
            const chatRoomId = `match_${lostId}_${foundId}`;
            const chatRoomLink = `${backendUrl}/?page=messages&room=${chatRoomId}`;

            // Create Chat Room
            const existingRoom = await ChatRoom.findOne({ roomId: chatRoomId });
            if (!existingRoom) {
              await new ChatRoom({
                roomId: chatRoomId,
                users: [originalUser._id, matchedUser._id],
                itemTitle1: originalItem.title,
                itemTitle2: item.title
              }).save();
            }

            // Attempt Email
            try {
               await transporter.sendMail({
                from: `"Retrievix Team" <admin@retrievix.in>`,
                to: [originalUser.email, matchedUser.email].join(", "),
                subject: 'Potential Match Found!',
                html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
  <h2 style="font-size: 24px; font-weight: bold;">Great News!</h2>
  <p>We found a potential match for your item with a high similarity score.</p>

  <h3 style="font-size: 18px; margin-top: 20px;">Your Item:</h3>
  <p style="margin: 5px 0; font-size: 14px;"><strong>Title:</strong> ${originalItem.title}</p>
  <p style="margin: 5px 0; font-size: 14px;"><strong>Description:</strong> ${originalItem.description}</p>
  <p style="margin: 5px 0; font-size: 14px;"><strong>Location:</strong> ${originalItem.location || 'Not specified'}</p>
  <p style="margin: 5px 0; font-size: 14px;"><strong>Contact:</strong> ${originalUser.name} - <a href="mailto:${originalUser.email}" style="color: #4F46E5; text-decoration: none;">${originalUser.email}</a>${originalUser.phone ? ` - ${originalUser.phone}` : ''}</p>

  <h3 style="font-size: 18px; margin-top: 20px;">Matched Item:</h3>
  <p style="margin: 5px 0; font-size: 14px;"><strong>Title:</strong> ${item.title}</p>
  <p style="margin: 5px 0; font-size: 14px;"><strong>Description:</strong> ${item.description}</p>
  <p style="margin: 5px 0; font-size: 14px;"><strong>Location:</strong> ${item.location || 'Not specified'}</p>
  <p style="margin: 5px 0; font-size: 14px;"><strong>Contact:</strong> ${matchedUser.name} - <a href="mailto:${matchedUser.email}" style="color: #4F46E5; text-decoration: none;">${matchedUser.email}</a>${matchedUser.phone ? ` - ${matchedUser.phone}` : ''}</p>
  <p style="margin: 5px 0; font-size: 14px;"><strong>Match Score:</strong> ${item.matchScore}%</p>

  <div style="background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin-top: 30px; text-align: center; border: 1px solid #e9ecef;">
    <h3 style="margin-top: 0; font-size: 16px;">Did you receive your item?</h3>
    <p style="font-size: 12px; color: #666; margin-bottom: 20px; line-height: 1.5;">
      If you have successfully met and claimed your item, please click the button below. This will tell our system that the item has been returned to its owner and securely remove the item from our database to prevent future alerts.
    </p>
    <a href="${backendUrl}/api/items/confirm-match/${originalItem._id}/${item._id}" style="display: inline-block; background-color: #28a745; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-bottom: 15px; width: 80%; max-width: 300px;">Confirm Item is Mine & Remove</a><br>
    <a href="${chatRoomLink}" style="display: inline-block; background-color: #4F46E5; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; width: 80%; max-width: 300px;">💬 Open Chat Room</a>
  </div>
</div>
`
              });
              console.log(`[DEBUG] Email sent successfully to ${originalUser.email} and ${matchedUser.email}`);
            } catch (mailErr) {
              console.error("[ERROR] Email notification failed:", mailErr);
            }

            if (!originalItem.notifiedMatches) originalItem.notifiedMatches = [];
            originalItem.notifiedMatches.push(item._id.toString());
            originalItemNeedsSave = true;
            await Item.findByIdAndUpdate(item._id, { $addToSet: { notifiedMatches: originalItem._id.toString() } });
          }
        }
      }
      if (originalItemNeedsSave) await originalItem.save();
    } catch (notifErr) {
      console.error("[ERROR] Notification logic failed:", notifErr.message);
    }

    // 5. Always return items
    res.json({ success: true, items: finalItems });

  } catch (err) {
    console.error(`[ERROR] Main Match logic failed:`, err.message);
    res.status(500).json({ success: false, message: "Match fetch failed", error: err.message });
  }
});

// --- GET single item by ID (used by showItemDetail popup) ---
app.get("/api/items/:id", async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: "Item not found" });
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/items/search", async (req, res) => {
  try {
    const { query } = req.query;
    const regex = new RegExp(query, 'i');
    const items = await Item.find({ $or: [{ title: regex }, { description: regex }] });
    res.json({ success: true, items });
  } catch (err) {
    res.json({ success: false });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    const logs = await FoundItemLog.find().sort({ timestamp: -1 });
    res.json({ success: true, logs });
  } catch (err) {
    res.json({ success: false, message: err.message });
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

app.get("/api/test-email", async (req, res) => {
  try {
    const info = await transporter.sendMail({
      from: `"Retrievix Team" <admin@retrievix.in>`,
      to: "admin@retrievix.in",
      subject: "Titan Mail Test",
      text: "This is a test email from the EC2 server."
    });
    res.json({ success: true, message: "Email sent successfully!", info });
  } catch (err) {
    res.json({ success: false, message: "Email failed to send", error: err.message, stack: err.stack });
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

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Socket.IO ---
io.on("connection", (socket) => {
  socket.on("join_room", (roomId) => socket.join(roomId));
  socket.on("send_message", async (data) => {
    const newMsg = new Message(data);
    await newMsg.save();
    io.to(data.roomId).emit("receive_message", newMsg);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));