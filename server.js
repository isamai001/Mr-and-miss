const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const app = express();

// Environment configuration
require('dotenv').config();
const {
  MONGO_URI = 'mongodb://localhost:27017/embakasi_voting',
  JWT_SECRET = 'your_jwt_secret',
  PORT = 3000,
  ADMIN_EMAIL = 'adminmme@yahoo.com',
  ADMIN_PASSWORD = 'mme@yahoo',
  UPLOAD_DIR = 'public/uploads',
  MAX_FILE_SIZE = 2 * 1024 * 1024, // 2MB
  ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/gif']
} = process.env;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});
app.use('/api/', apiLimiter);

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'contestant-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_FILE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and GIF images are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: fileFilter
});

// Serve static files
app.use(express.static('public'));

// MongoDB connection
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useCreateIndex: true,
  useFindAndModify: false
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Admin Schema
const adminSchema = new mongoose.Schema({
  email: { 
    type: String, 
    unique: true, 
    required: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
  },
  password: { 
    type: String, 
    required: true,
    minlength: 6
  }
});

// Contestant Schema
const contestantSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true,
    minlength: 3
  },
  phone: { 
    type: String, 
    required: true,
    match: [/^254[17]\d{8}$/, 'Please fill a valid Kenyan phone number']
  },
  email: { 
    type: String,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
  },
  category: { 
    type: String, 
    required: true,
    enum: ['mr', 'miss']
  },
  bio: { 
    type: String, 
    maxlength: 500 
  },
  photo: { 
    type: String, 
    required: true 
  },
  registeredOn: { 
    type: Date, 
    default: Date.now 
  },
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected'], 
    default: 'pending' 
  },
  votes: { 
    type: Number, 
    default: 0,
    min: 0
  },
  adminNotes: String,
  approvedOn: Date
}, { timestamps: true });

// Vote Transaction Schema
const voteTransactionSchema = new mongoose.Schema({
  contestantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Contestant',
    required: true 
  },
  contestantName: { 
    type: String, 
    required: true 
  },
  votes: { 
    type: Number, 
    required: true,
    min: 1
  },
  amount: { 
    type: Number, 
    required: true,
    min: 20
  },
  phone: { 
    type: String, 
    required: true,
    match: [/^254[17]\d{8}$/, 'Please fill a valid Kenyan phone number']
  }
}, { timestamps: true });

// Config Schema
const configSchema = new mongoose.Schema({
  key: { 
    type: String, 
    unique: true, 
    required: true 
  },
  value: { 
    type: mongoose.Schema.Types.Mixed, 
    required: true 
  }
});

// Models
const Admin = mongoose.model('Admin', adminSchema);
const Contestant = mongoose.model('Contestant', contestantSchema);
const VoteTransaction = mongoose.model('VoteTransaction', voteTransactionSchema);
const Config = mongoose.model('Config', configSchema);

// Initialize application data
async function initializeData() {
  try {
    // Voting status configuration
    const votingStatus = await Config.findOne({ key: 'votingEnabled' });
    if (!votingStatus) {
      await Config.create({ key: 'votingEnabled', value: true });
    }

    // Admin user setup
    const admin = await Admin.findOne({ email: ADMIN_EMAIL });
    if (!admin) {
      const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
      await Admin.create({
        email: ADMIN_EMAIL,
        password: hashedPassword
      });
      console.log('Admin user created');
    }
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

initializeData();

// Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access denied' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
}

// API Routes

// Authentication
app.post('/api/auth/login', 
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 })
  ],
  validateRequest,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const admin = await Admin.findOne({ email });
      
      if (!admin || !await bcrypt.compare(password, admin.password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const token = jwt.sign({ email: admin.email }, JWT_SECRET, { expiresIn: '1h' });
      res.json({ token });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Login error' });
    }
  }
);

// Contestant Registration with File Upload
app.post('/api/contestants/register', 
  upload.single('photo'),
  [
    body('name').trim().isLength({ min: 3 }),
    body('phone').matches(/^254[17]\d{8}$/),
    body('email').optional().isEmail(),
    body('category').isIn(['mr', 'miss']),
    body('bio').optional().isLength({ max: 500 })
  ],
  async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Remove uploaded file if validation fails
      if (req.file) {
        fs.unlinkSync(path.join(UPLOAD_DIR, req.file.filename));
      }
      return res.status(400).json({ errors: errors.array() });
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a photo' });
    }

    try {
      const { name, phone, email, category, bio } = req.body;
      
      // Check for existing contestant
      const existingContestant = await Contestant.findOne({ 
        $or: [{ phone }, { email }]
      });

      if (existingContestant) {
        fs.unlinkSync(path.join(UPLOAD_DIR, req.file.filename));
        return res.status(400).json({ 
          error: 'Contestant with this phone or email already exists' 
        });
      }

      // Create photo URL
      const photoUrl = '/uploads/' + req.file.filename;

      // Create new contestant
      const contestant = new Contestant({
        name,
        phone,
        email,
        category,
        bio,
        photo: photoUrl,
        status: 'pending'
      });

      await contestant.save();

      res.status(201).json({ 
        message: 'Registration successful',
        contestant: {
          id: contestant._id,
          name: contestant.name,
          photo: photoUrl,
          category: contestant.category
        }
      });

    } catch (error) {
      // Clean up file if error occurs
      if (req.file) {
        fs.unlinkSync(path.join(UPLOAD_DIR, req.file.filename));
      }
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Error registering contestant' });
    }
  }
);

// Get Contestants
app.get('/api/contestants', async (req, res) => {
  try {
    const { status, category } = req.query;
    const query = {};
    
    if (status) query.status = status;
    if (category) query.category = category;
    
    const contestants = await Contestant.find(query)
      .sort({ votes: -1, createdAt: -1 });
      
    res.json(contestants);
  } catch (error) {
    console.error('Error fetching contestants:', error);
    res.status(500).json({ error: 'Error fetching contestants' });
  }
});

// Admin-only endpoints
app.use('/api/admin', authenticateToken);

// Approve Contestant
app.patch('/api/admin/contestants/:id/approve', 
  [
    body('adminNotes').optional().isString()
  ],
  validateRequest,
  async (req, res) => {
    try {
      const contestant = await Contestant.findByIdAndUpdate(
        req.params.id,
        { 
          status: 'approved',
          adminNotes: req.body.adminNotes,
          approvedOn: new Date()
        },
        { new: true }
      );

      if (!contestant) {
        return res.status(404).json({ error: 'Contestant not found' });
      }

      res.json({ 
        message: 'Contestant approved',
        contestant
      });
    } catch (error) {
      console.error('Approval error:', error);
      res.status(400).json({ error: 'Error approving contestant' });
    }
  }
);

// Reject Contestant
app.patch('/api/admin/contestants/:id/reject', 
  [
    body('adminNotes').optional().isString()
  ],
  validateRequest,
  async (req, res) => {
    try {
      const contestant = await Contestant.findByIdAndUpdate(
        req.params.id,
        { 
          status: 'rejected',
          adminNotes: req.body.adminNotes
        },
        { new: true }
      );

      if (!contestant) {
        return res.status(404).json({ error: 'Contestant not found' });
      }

      res.json({ 
        message: 'Contestant rejected',
        contestant
      });
    } catch (error) {
      console.error('Rejection error:', error);
      res.status(400).json({ error: 'Error rejecting contestant' });
    }
  }
);

// Delete Contestant
app.delete('/api/admin/contestants/:id', async (req, res) => {
  try {
    const contestant = await Contestant.findByIdAndDelete(req.params.id);
    
    if (!contestant) {
      return res.status(404).json({ error: 'Contestant not found' });
    }

    // Delete associated photo
    if (contestant.photo) {
      const photoPath = path.join('public', contestant.photo);
      if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
    }

    await VoteTransaction.deleteMany({ contestantId: req.params.id });
    res.json({ message: 'Contestant deleted' });
  } catch (error) {
    console.error('Deletion error:', error);
    res.status(400).json({ error: 'Error deleting contestant' });
  }
});

// Voting Endpoints
app.post('/api/votes',
  [
    body('contestantId').isMongoId(),
    body('contestantName').isString(),
    body('votes').isInt({ min: 1 }),
    body('amount').isInt({ min: 20 }),
    body('phone').matches(/^254[17]\d{8}$/)
  ],
  validateRequest,
  async (req, res) => {
    try {
      // Check if voting is enabled
      const votingStatus = await Config.findOne({ key: 'votingEnabled' });
      if (!votingStatus?.value) {
        return res.status(403).json({ error: 'Voting is currently disabled' });
      }

      // Check if contestant exists and is approved
      const contestant = await Contestant.findById(req.body.contestantId);
      if (!contestant || contestant.status !== 'approved') {
        return res.status(400).json({ error: 'Invalid contestant' });
      }

      const transaction = new VoteTransaction({
        ...req.body,
        contestantName: contestant.name
      });

      await transaction.save();
      
      // Update contestant votes
      contestant.votes += req.body.votes;
      await contestant.save();
      
      res.status(201).json({ 
        message: 'Vote recorded',
        transactionId: transaction._id,
        contestant: {
          id: contestant._id,
          name: contestant.name,
          votes: contestant.votes
        }
      });
    } catch (error) {
      console.error('Voting error:', error);
      res.status(400).json({ error: 'Error processing vote' });
    }
  }
);

// Get Vote Transactions
app.get('/api/votes', async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const transactions = await VoteTransaction.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('contestantId', 'name photo category');
      
    const total = await VoteTransaction.countDocuments();
    
    res.json({
      transactions,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching votes:', error);
    res.status(500).json({ error: 'Error fetching vote transactions' });
  }
});

// Voting Configuration
app.get('/api/config/voting-status', async (req, res) => {
  try {
    const config = await Config.findOne({ key: 'votingEnabled' });
    res.json({ votingEnabled: config?.value ?? true });
  } catch (error) {
    console.error('Config error:', error);
    res.status(500).json({ error: 'Error fetching voting status' });
  }
});

app.patch('/api/admin/config/voting-status',
  [
    body('votingEnabled').isBoolean()
  ],
  validateRequest,
  async (req, res) => {
    try {
      await Config.findOneAndUpdate(
        { key: 'votingEnabled' },
        { value: req.body.votingEnabled },
        { upsert: true }
      );
      res.json({ message: 'Voting status updated' });
    } catch (error) {
      console.error('Config update error:', error);
      res.status(500).json({ error: 'Error updating voting status' });
    }
  }
);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin email: ${ADMIN_EMAIL}`);
  console.log(`Upload directory: ${UPLOAD_DIR}`);
});