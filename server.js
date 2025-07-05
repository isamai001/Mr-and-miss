const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = express();

app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/embakasi_voting', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Admin Schema
const adminSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true }
});

const Admin = mongoose.model('Admin', adminSchema);

// Contestant Schema
const contestantSchema = new mongoose.Schema({
    name: String,
    phone: String,
    email: String,
    category: String,
    bio: String,
    photo: String,
    registeredOn: String,
    status: { type: String, default: 'pending' },
    votes: { type: Number, default: 0 },
    adminNotes: String
});

const Contestant = mongoose.model('Contestant', contestantSchema);

// Vote Transaction Schema
const voteTransactionSchema = new mongoose.Schema({
    contestantId: mongoose.Schema.Types.ObjectId,
    contestantName: String,
    votes: Number,
    amount: Number,
    phone: String,
    timestamp: String
});

const VoteTransaction = mongoose.model('VoteTransaction', voteTransactionSchema);

// Config Schema
const configSchema = new mongoose.Schema({
    key: String,
    value: Boolean
});

const Config = mongoose.model('Config', configSchema);

// Initialize voting status and admin user
async function initializeConfig() {
    const votingStatus = await Config.findOne({ key: 'votingEnabled' });
    if (!votingStatus) {
        await Config.create({ key: 'votingEnabled', value: true });
    }
    
    const admin = await Admin.findOne({ email: 'adminmme@yahoo.com' });
    if (!admin) {
        const hashedPassword = await bcrypt.hash('mme@yahoo', 10);
        await Admin.create({
            email: 'adminmme@yahoo.com',
            password: hashedPassword
        });
    }
}

initializeConfig();

// Middleware to verify JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: 'Access denied' });
    
    try {
        const verified = jwt.verify(token, 'your_jwt_secret');
        req.user = verified;
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
}

// API Routes
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const admin = await Admin.findOne({ email });
        
        if (!admin || !await bcrypt.compare(password, admin.password)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ email: admin.email }, 'your_jwt_secret', { expiresIn: '1h' });
        res.json({ token });
    } catch (error) {
        res.status(500).json({ error: 'Login error' });
    }
});

app.get('/api/contestants', authenticateToken, async (req, res) => {
    try {
        const { status } = req.query;
        const contestants = await Contestant.find(status ? { status } : {});
        res.json(contestants);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching contestants' });
    }
});

app.post('/api/contestants/register', async (req, res) => {
    try {
        const contestant = new Contestant(req.body);
        await contestant.save();
        res.status(201).json({ message: 'Registration successful' });
    } catch (error) {
        res.status(400).json({ error: 'Error registering contestant' });
    }
});

app.patch('/api/contestants/:id/approve', authenticateToken, async (req, res) => {
    try {
        const contestant = await Contestant.findByIdAndUpdate(
            req.params.id,
            { 
                status: 'approved',
                adminNotes: req.body.adminNotes,
                approvedOn: new Date().toISOString().split('T')[0]
            },
            { new: true }
        );
        if (!contestant) throw new Error('Contestant not found');
        res.json({ message: 'Contestant approved' });
    } catch (error) {
        res.status(400).json({ error: 'Error approving contestant' });
    }
});

app.delete('/api/contestants/:id', authenticateToken, async (req, res) => {
    try {
        const contestant = await Contestant.findByIdAndDelete(req.params.id);
        if (!contestant) throw new Error('Contestant not found');
        await VoteTransaction.deleteMany({ contestantId: req.params.id });
        res.json({ message: 'Contestant deleted' });
    } catch (error) {
        res.status(400).json({ error: 'Error deleting contestant' });
    }
});

app.post('/api/votes', async (req, res) => {
    try {
        const transaction = new VoteTransaction(req.body);
        await transaction.save();
        
        await Contestant.findByIdAndUpdate(
            req.body.contestantId,
            { $inc: { votes: req.body.votes } }
        );
        
        res.status(201).json({ message: 'Vote recorded' });
    } catch (error) {
        res.status(400).json({ error: 'Error processing vote' });
    }
});

app.get('/api/votes', authenticateToken, async (req, res) => {
    try {
        const transactions = await VoteTransaction.find().sort({ timestamp: -1 }).limit(50);
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching vote transactions' });
    }
});

app.delete('/api/votes/reset', authenticateToken, async (req, res) => {
    try {
        await Contestant.updateMany({}, { $set: { votes: 0 } });
        await VoteTransaction.deleteMany({});
        res.json({ message: 'All votes reset' });
    } catch (error) {
        res.status(500).json({ error: 'Error resetting votes' });
    }
});

app.get('/api/config/voting-status', async (req, res) => {
    try {
        const config = await Config.findOne({ key: 'votingEnabled' });
        res.json({ votingEnabled: config ? config.value : true });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching voting status' });
    }
});

app.patch('/api/config/voting-status', authenticateToken, async (req, res) => {
    try {
        const { votingEnabled } = req.body;
        await Config.findOneAndUpdate(
            { key: 'votingEnabled' },
            { value: votingEnabled },
            { upsert: true }
        );
        res.json({ message: 'Voting status updated' });
    } catch (error) {
        res.status(500).json({ error: 'Error updating voting status' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));