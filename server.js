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

// Replaced Nodemailer SMTP setup with our powerful free Webhook!
const GOOGLE_APPS_SCRIPT_WEBHOOK = "https://script.google.com/macros/s/AKfycbwi9puTWR1bx73sp4Zh2INAiQAFID3-qJEqiCBikKBsBsvZrLKk4qV8HNUcB5RhRSAd/exec";

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increase limit for image uploads
app.use(express.static(__dirname)); // Serve frontend static files

// Wait to connect to MongoDB until schemas are defined below

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
  type: String,  // "lost" or "found"
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

// MongoDB connection - Using MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB Atlas Connected");
    // Kick off gentle background sync when server wakes up
    syncAiService();
  })
  .catch(err => console.error(err));

// Add a function to gently sync missing AI items on Startup without blocking or loops
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
      console.log(`Found ${missingItems.length} items missing in AI index. Re-syncing slowly in background...`);
      for (const item of missingItems) {
        try {
          await axios.post(`${AI_SERVICE_URL}/add_item`, {
            itemId: item._id.toString(),
            title: item.title,
            description: item.description,
            imageUrl: item.image
          });
          console.log(`Synced missing item ${item._id} to AI.`);
          await new Promise(r => setTimeout(r, 1500)); // Sleep 1.5s to respect free computing limits
        } catch (err) {
          console.error(`Failed to sync item ${item._id}:`, err.message);
        }
      }
      console.log("AI Sync complete!");
    } else {
      console.log("AI service is fully synced with database.");
    }
  } catch (err) {
    console.error("Error during AI sync loop:", err.message);
  }
}

// Routes
// ✅ Register
// Password validation function
function isValidPassword(password) {
  const minLength = 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[@$!%*?&]/.test(password);

  return (
    password.length >= minLength &&
    hasUpper &&
    hasLower &&
    hasNumber &&
    hasSpecial
  );
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // 🔹 validate password
    if (!isValidPassword(password)) {
      return res.json({
        success: false,
        message:
          "Password must be at least 8 characters long and include uppercase, lowercase, number, and special character."
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = new User({
      name,
      email,
      phone,
      password: hashedPassword
    });

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


// ✅ Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.json({ success: false, message: "Invalid email or password" });
    }

    // compare plain password with hashed password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.json({ success: false, message: "Invalid email or password" });
    }

    res.json({ success: true, user });
  } catch (err) {
    res.json({ success: false, message: "Login failed" });
  }
});


// // ✅ Get items by type
app.get("/api/items", async (req, res) => {
  try {
    const { type } = req.query;
    if (!type) {
      return res.json({ success: false, message: "Type parameter is required" });
    }
    const items = await Item.find({ type });
    res.json({ success: true, items });
  } catch (err) {
    console.error("Error fetching items:", err);
    res.json({ success: false, message: "Failed to fetch items" });
  }
});

// // ✅ Create item
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
      console.log(`Item ${item._id} sent to AI service for indexing.`);
    } catch (aiError) {
      console.error(`Failed to index item ${item._id} in AI service:`
        , aiError.message);
    }

    res.json({ success: true, item });
  } catch (err) {
    console.error("Error saving item:", err);
    res.json({ success: false, message: "Failed to save item" });
  }
});

// ✅ Get single item
app.get("/api/items/:id", async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) {
      return res.json({ success: false, message: "Item not found" });
    }
    res.json({ success: true, item });
  } catch (err) {
    console.error("Error fetching item:", err);
    res.json({ success: false, message: "Failed to fetch item" });
  }
});

// // ✅ Get items
app.get("/api/items/:id/matches", async (req, res) => {
  try {
    const { id } = req.params;
    const originalItem = await Item.findById(id);

    if (!originalItem) {
      return res.json({ success: false, message: "Original item not found" });
    }

    // Determine the opposite type to search for.
    const oppositeType = originalItem.type === 'lost' ? 'found' : 'lost';

    // 1. Get match IDs from the Python AI service using find_matches for better similarity
    const response = await axios.get(`${AI_SERVICE_URL}/find_matches`, {
      params: { item_id: id }
    });
    const matches = response.data.matches || []; // e.g., [{ itemId: "...", distance: 0.1 }, ...]

    if (matches.length === 0) {
      return res.json({ success: true, items: [] });
    }

    const matchIds = matches.map(m => m.itemId);

    // 2. Fetch the full item details for the matches from MongoDB
    const potentialMatchItems = await Item.find({
      '_id': { $in: matchIds }, // Find all items whose ID is in our matched list
      'type': oppositeType      // Only include items of the opposite type
      // 'userId': { $ne: originalItem.userId } // TEMPORARILY DISABLED for testing purposes
    });

    // 3. Add the match score (distance) to the final items
    const finalItems = potentialMatchItems.map(item => {
      const matchInfo = matches.find(m => m.itemId === item._id.toString());
      // Convert L2 squared distance to cosine similarity
      // distance = 2 - 2 * cosineSimilarity => cosineSimilarity = 1 - (distance / 2)
      const cosineSimilarity = 1 - (matchInfo.distance / 2);

      // Scale cosine similarity so that > 0.4 becomes a useful 0-100% score for users
      const mappedScore = Math.max(0, (cosineSimilarity - 0.4) / 0.6);
      const matchScore = Math.round(mappedScore * 100);

      return {
        ...item.toObject(),
        matchScore: matchScore
      };
    });

    // 4. Send emails if match score >= 80
    let originalItemNeedsSave = false;
    for (const item of finalItems) {
      if (item.matchScore >= 80 && !(originalItem.notifiedMatches || []).includes(item._id.toString())) {
        try {
          const originalUser = await User.findById(originalItem.userId);
          const matchedUser = await User.findById(item.userId);

          if (originalUser && matchedUser) {
            // Generate the confirmation link and chat room link
            const backendUrl = req.protocol + '://' + req.get('host');
            const confirmationLink = `${backendUrl}/api/items/confirm-match/${originalItem._id}/${item._id}`;
            
            const lostId = originalItem.type === 'lost' ? originalItem._id : item._id;
            const foundId = originalItem.type === 'found' ? originalItem._id : item._id;
            const chatRoomId = `match_${lostId}_${foundId}`;
            
            const chatRoomLink = `${backendUrl}/?page=messages&room=${chatRoomId}`;

            const mailOptions = {
              from: process.env.SMTP_USER || 'retrievix01@gmail.com',
              to: [originalUser.email, matchedUser.email],
              subject: 'Potential Match Found for Your Item!',
              html: `
                <h2>Great News!</h2>
                <p>We found a potential match for your item with a high similarity score.</p>
                <h3>Your Item:</h3>
                <p><strong>Title:</strong> ${originalItem.title}</p>
                <p><strong>Description:</strong> ${originalItem.description}</p>
                <p><strong>Location:</strong> ${originalItem.location}</p>
                <p><strong>Contact:</strong> ${originalUser.name} - ${originalUser.email} - ${originalUser.phone}</p>
                <h3>Matched Item:</h3>
                <p><strong>Title:</strong> ${item.title}</p>
                <p><strong>Description:</strong> ${item.description}</p>
                <p><strong>Location:</strong> ${item.location}</p>
                <p><strong>Contact:</strong> ${matchedUser.name} - ${matchedUser.email} - ${matchedUser.phone}</p>
                <p><strong>Match Score:</strong> ${item.matchScore}%</p>
                <br>
                <div style="background-color: #f8f9fa; border: 1px solid #ddd; padding: 20px; border-radius: 8px; text-align: center;">
                  <h3 style="margin-top: 0; color: #333;">Did you receive your item?</h3>
                  <p style="color: #555;">If you have successfully met and claimed your item, please click the button below. This will tell our system that the item has been returned to its owner and securely remove the item from our database to prevent future alerts.</p>
                  <a href="${confirmationLink}" style="display: inline-block; padding: 12px 24px; color: #ffffff; background-color: #28a745; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; margin-bottom: 10px;">Confirm Item is Mine & Remove</a>
                  <br>
                  <a href="${chatRoomLink}" style="display: inline-block; padding: 12px 24px; color: #ffffff; background-color: #4F46E5; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">💬 Open Chat Room</a>
                </div>
                <br>
                <p>Please contact each other to verify and arrange the return.</p>
                <p>Best regards,<br>Retrievix Team</p>
              `
            };

            // Call the Google Apps Script Webhook securely via HTTPS 
            // This safely bypasses Render's free tier ban on SMTP!
            await axios.post(GOOGLE_APPS_SCRIPT_WEBHOOK, mailOptions);
            console.log(`Email sent for match between ${originalItem._id} and ${item._id}`);
            
            // Create chat room
            try {
              const existingRoom = await ChatRoom.findOne({ roomId: chatRoomId });
              if (!existingRoom) {
                const newRoom = new ChatRoom({
                  roomId: chatRoomId,
                  users: [originalUser._id, matchedUser._id],
                  itemTitle1: originalItem.title,
                  itemTitle2: item.title
                });
                await newRoom.save();
              }
            } catch (roomErr) {
              console.error('Error creating chat room:', roomErr);
            }
            
            // Mark as notified for both items so it doesn't send again
            if (!originalItem.notifiedMatches) originalItem.notifiedMatches = [];
            originalItem.notifiedMatches.push(item._id.toString());
            originalItemNeedsSave = true;
            
            await Item.findByIdAndUpdate(item._id, { $addToSet: { notifiedMatches: originalItem._id.toString() } });
          }
        } catch (emailError) {
          console.error('Error sending email through webhook:', emailError.message);
        }
      }
    }

    if (originalItemNeedsSave) {
      await originalItem.save();
    }

    res.json({ success: true, items: finalItems });

  } catch (err) {
    console.error("Error fetching matches:", err.message);
    res.json({ success: false, message: "Failed to fetch matches" });
  }
});

// ✅ Confirm Match and Delete Items (Triggered from Email)
app.get("/api/items/confirm-match/:id1/:id2", async (req, res) => {
  try {
    const { id1, id2 } = req.params;

    // Fetch items to save in history log
    const item1 = await Item.findById(id1);
    const item2 = await Item.findById(id2);

    if (item1 || item2) {
      // Save to FoundItemLog
      const log = new FoundItemLog({
        title1: item1 ? item1.title : 'Deleted Item',
        title2: item2 ? item2.title : 'Deleted Item',
        description1: item1 ? item1.description : '',
        description2: item2 ? item2.description : '',
        location1: item1 ? item1.location : '',
        location2: item2 ? item2.location : '',
        contact1: item1 ? item1.contactInfo : '',
        contact2: item2 ? item2.contactInfo : '',
        user1Id: item1 ? item1.userId : '',
        user2Id: item2 ? item2.userId : ''
      });
      await log.save();
    }

    // Delete both items from the database
    const deleted1 = await Item.findByIdAndDelete(id1);
    const deleted2 = await Item.findByIdAndDelete(id2);

    // Delete associated chat room and messages
    let lostId = id1;
    let foundId = id2;
    if (item1 && item1.type === 'found') {
      lostId = id2;
      foundId = id1;
    } else if (item2 && item2.type === 'lost') {
      lostId = id2;
      foundId = id1;
    }
    const chatRoomId = `match_${lostId}_${foundId}`;
    await ChatRoom.findOneAndDelete({ roomId: chatRoomId });
    await Message.deleteMany({ roomId: chatRoomId });

    if (deleted1 || deleted2) {
      res.send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f4f7f6;">
            <div style="background-color: white; padding: 40px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
              <h2 style="color: #28a745;">✅ Match Confirmed!</h2>
              <p style="font-size: 18px; color: #333;">The items have been successfully securely removed from our database.</p>
              <p style="color: #555;">Thank you for using Retrievix to find your belongings. We're glad we could help!</p>
              <br/>
              <p style="color: #777; font-size: 14px;">You may now close this window.</p>
              <br/>
              <a href="/" style="display: inline-block; padding: 10px 20px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">Return to Retrievix</a>
            </div>
          </body>
        </html>
      `);
    } else {
      res.send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f4f7f6;">
            <div style="background-color: white; padding: 40px; border-radius: 10px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
              <h2 style="color: #6c757d;">Already Processed</h2>
              <p style="font-size: 18px; color: #333;">These items have already been removed or cannot be found.</p>
              <p style="color: #555;">They may have been deleted by the other user first.</p>
              <br/>
              <p style="color: #777; font-size: 14px;">You may now close this window.</p>
              <br/>
              <a href="/" style="display: inline-block; padding: 10px 20px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">Return to Retrievix</a>
            </div>
          </body>
        </html>
      `);
    }
  } catch (err) {
    console.error("Error confirming match & deleting items:", err);
    res.status(500).send("An error occurred while confirming the match. Please try again later.");
  }
});

// ✅ Search items
app.get("/api/items/search", async (req, res) => {
  try {
    const { query, type, userId } = req.query;

    if (!query) {
      return res.json({ success: false, message: "Query parameter is required" });
    }

    // Create regex for case-insensitive search
    const searchRegex = new RegExp(query, 'i');

    // Build search query
    const searchQuery = {
      $or: [
        { title: { $regex: searchRegex } },
        { description: { $regex: searchRegex } }
      ]
    };

    // Add type filter if provided
    if (type) {
      searchQuery.type = type;
    }

    // Exclude user's own items if userId is provided
    if (userId) {
      searchQuery.userId = { $ne: userId };
    }

    // Search items directly from database
    const items = await Item.find(searchQuery);

    res.json({ success: true, items });

  } catch (err) {
    console.error("Error searching items:", err.message);
    res.json({ success: false, message: "Failed to search items" });
  }
});



// ✅ Delete item
app.delete("/api/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const item = await Item.findById(id);

    if (!item) {
      return res.json({ success: false, message: "Item not found" });
    }

    // Check if user owns the item
    if (item.userId !== req.body.userId) {
      return res.json({ success: false, message: "Unauthorized to delete this item" });
    }

    await Item.findByIdAndDelete(id);
    res.json({ success: true, message: "Item deleted successfully" });
  } catch (err) {
    res.json({ success: false, message: "Failed to delete item" });
  }
});

// ✅ Fetch messages for a room
app.get("/api/messages/:roomId", async (req, res) => {
  try {
    const { roomId } = req.params;
    const messages = await Message.find({ roomId }).sort({ timestamp: 1 });
    res.json({ success: true, messages });
  } catch (err) {
    res.json({ success: false, message: "Failed to fetch messages" });
  }
});

// ✅ Fetch chat rooms for a user
app.get("/api/chats/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const rooms = await ChatRoom.find({ users: userId }).populate('users', 'name email');
    res.json({ success: true, rooms });
  } catch (err) {
    res.json({ success: false, message: "Failed to fetch chat rooms" });
  }
});

// ✅ Fetch item history logs
app.get("/api/history", async (req, res) => {
  try {
    const logs = await FoundItemLog.find({}).sort({ timestamp: -1 });
    res.json({ success: true, logs });
  } catch (err) {
    res.json({ success: false, message: "Failed to fetch history logs" });
  }
});

// ✅ Fetch user profile and their public items
app.get("/api/users/:id/profile", async (req, res) => {
  try {
    const user = await User.findById(req.params.id, 'name');
    if (!user) return res.json({ success: false, message: "User not found" });

    const items = await Item.find({ userId: req.params.id });
    res.json({ success: true, user, items });
  } catch (err) {
    res.json({ success: false, message: "Failed to fetch profile" });
  }
});

// Serve index.html for all other routes to support SPA routing
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ====== Socket.IO Logic ======
io.on("connection", (socket) => {
  console.log("User connected to socket:", socket.id);

  socket.on("join_room", (roomId) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room ${roomId}`);
  });

  socket.on("send_message", async (data) => {
    try {
      const { roomId, senderId, receiverId, message } = data;
      // Save message to DB
      const newMsg = new Message({ roomId, senderId, receiverId, message });
      await newMsg.save();
      // Broadcast to room
      io.to(roomId).emit("receive_message", newMsg);
    } catch (err) {
      console.error("Error saving message:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`))
