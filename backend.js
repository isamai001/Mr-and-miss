const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/embakasi2023', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Schemas
const contestantSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String },
    category: { type: String, required: true, enum: ['mr', 'miss'] },
    bio: { type: String },
    photo: { type: String, required: true },
    registeredOn: { type: String, required: true },
    status: { type: String, required: true, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    votes: { type: Number, default: 0 },
    adminNotes: { type: String }
});

const voteSchema = new mongoose.Schema({
    contestantId: { type: Number, required: true },
    contestantName: { type: String, required: true },
    votes: { type: Number, required: true },
    amount: { type: Number, required: true },
    phone: { type: String, required: true },
    timestamp: { type: String, required: true },
    accountNumber: { type: String, required: true }
});

const votingStatusSchema = new mongoose.Schema({
    votingEnabled: { type: Boolean, default: true }
});

const adminSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const Contestant = mongoose.model('Contestant', contestantSchema);
const Vote = mongoose.model('Vote', voteSchema);
const VotingStatus = mongoose.model('VotingStatus', votingStatusSchema);
const Admin = mongoose.model('Admin', adminSchema);

// Initialize data
async function initializeData() {
    const status = await VotingStatus.findOne();
    if (!status) {
        await VotingStatus.create({ votingEnabled: true });
    }

    const admin = await Admin.findOne({ email: 'admin@example.com' });
    if (!admin) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await Admin.create({ email: 'admin@example.com', password: hashedPassword });
    }
}

// Middleware to verify admin token
function verifyAdminToken(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token || token !== 'admin-token') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// API Endpoints

// Admin login
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const admin = await Admin.findOne({ email });
        if (!admin) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        res.json({ token: 'admin-token' }); // Placeholder token
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// Get approved contestants
app.get('/api/contestants/approved', async (req, res) => {
    try {
        const contestants = await Contestant.find({ status: 'approved' });
        res.json(contestants);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch contestants' });
    }
});

// Get pending contestants
app.get('/api/contestants/pending', verifyAdminToken, async (req, res) => {
    try {
        const contestants = await Contestant.find({ status: 'pending' });
        res.json(contestants);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch pending contestants' });
    }
});

// Register contestant
app.post('/api/contestants/register', async (req, res) => {
    try {
        const contestantData = req.body;
        const lastContestant = await Contestant.findOne().sort({ id: -1 });
        contestantData.id = lastContestant ? lastContestant.id + 1 : 1;
        const contestant = new Contestant(contestantData);
        await contestant.save();
        res.status(201).json({ message: 'Registration submitted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to register contestant' });
    }
});

// Approve contestant
app.post('/api/contestants/approve', verifyAdminToken, async (req, res) => {
    try {
        const { id, adminNotes } = req.body;
        await Contestant.updateOne({ id }, { status: 'approved', adminNotes });
        res.json({ message: 'Contestant approved' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to approve contestant' });
    }
});

// Reject/Delete contestant
app.post('/api/contestants/reject', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.body;
        await Contestant.updateOne({ id }, { status: 'rejected' });
        await Vote.deleteMany({ contestantId: id });
        res.json({ message: 'Contestant rejected' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reject contestant' });
    }
});

// Process vote
app.post('/api/votes', async (req, res) => {
    try {
        const voteData = req.body;
        const vote = new Vote(voteData);
        await vote.save();
        await Contestant.updateOne(
            { id: voteData.contestantId },
            { $inc: { votes: voteData.votes } }
        );
        res.status(201).json({ message: 'Vote recorded' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to process vote' });
    }
});

// Get vote transactions
app.get('/api/votes', verifyAdminToken, async (req, res) => {
    try {
        const votes = await Vote.find().sort({ timestamp: -1 }).limit(50);
        res.json(votes);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch votes' });
    }
});

// Get voting status
app.get('/api/voting-status', async (req, res) => {
    try {
        const status = await VotingStatus.findOne();
        res.json({ votingEnabled: status.votingEnabled });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch voting status' });
    }
});

// Update voting status
app.post('/api/voting-status', verifyAdminToken, async (req, res) => {
    try {
        const { votingEnabled } = req.body;
        await VotingStatus.updateOne({}, { votingEnabled }, { upsert: true });
        res.json({ message: 'Voting status updated' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update voting status' });
    }
});

// Reset all votes
app.post('/api/votes/reset', verifyAdminToken, async (req, res) => {
    try {
        await Contestant.updateMany({}, { $set: { votes: 0 } });
        await Vote.deleteMany({});
        res.json({ message: 'All votes reset' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reset votes' });
    }
});

// Start server
app.listen(PORT, async () => {
    await initializeData();
    console.log(`Server running on port ${PORT}`);
});