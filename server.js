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
const nodemailer = require('nodemailer');
const app = express();

// Environment configuration
require('dotenv').config();
const {
  MONGO_URI = 'mongodb://localhost:27017/embakasi_voting',
  JWT_SECRET = 'your_jwt_secret',
  PORT = 3000,
  ADMIN_EMAIL = 'admin@embakasi.com',
  ADMIN_PASSWORD = 'securePassword123',
  UPLOAD_DIR = 'public/uploads',
  MAX_FILE_SIZE = 2 * 1024 * 1024, // 2MB
  ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png'],
  SMTP_HOST = 'smtp.example.com',
  SMTP_PORT = 587,
  SMTP_USER = 'noreply@embakasi.com',
  SMTP_PASS = 'smtpPassword123',
  FRONTEND_URL = 'http://localhost:8080'
} = process.env;

// Email transporter configuration
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: false,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS
  }
});

// Security middleware
app.use(helmet());
app.use(cors({
  origin: FRONTEND_URL,
  optionsSuccessStatus: 200
}));
app.use(express.json({ limit: '10kb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later'
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
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'contestant-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_FILE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG and PNG images are allowed.'), false);
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
    useUnifiedTopology: true
  }).then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));
// Schema Definitions
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
    minlength: 8,
    select: false
  },
  lastLogin: Date,
  role: { type: String, enum: ['admin', 'superadmin'], default: 'admin' }
}, { timestamps: true });

const contestantSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 50
  },
  phone: { 
    type: String, 
    required: true,
    match: [/^254[17]\d{8}$/, 'Please fill a valid Kenyan phone number'],
    index: true
  },
  email: { 
    type: String,
    lowercase: true,
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
    default: 'pending',
    index: true
  },
  votes: { 
    type: Number, 
    default: 0,
    min: 0
  },
  adminNotes: String,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  approvedOn: Date,
  rejectionReason: String
}, { timestamps: true });

const voteTransactionSchema = new mongoose.Schema({
  contestantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Contestant',
    required: true,
    index: true
  },
  contestantName: { 
    type: String, 
    required: true 
  },
  votes: { 
    type: Number, 
    required: true,
    min: 1,
    max: 100
  },
  amount: { 
    type: Number, 
    required: true,
    min: 20
  },
  phone: { 
    type: String, 
    required: true,
    match: [/^254[17]\d{8}$/, 'Please fill a valid Kenyan phone number'],
    index: true
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  paymentReference: String
}, { timestamps: true });

const configSchema = new mongoose.Schema({
  key: { 
    type: String, 
    unique: true, 
    required: true,
    index: true
  },
  value: { 
    type: mongoose.Schema.Types.Mixed, 
    required: true 
  },
  description: String,
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
}, { timestamps: true });

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
      await Config.create({ 
        key: 'votingEnabled', 
        value: true,
        description: 'Controls whether voting is enabled system-wide'
      });
    }

    // Admin user setup
    const admin = await Admin.findOne({ email: ADMIN_EMAIL });
    if (!admin) {
      const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12);
      await Admin.create({
        email: ADMIN_EMAIL,
        password: hashedPassword,
        role: 'superadmin'
      });
      console.log('Admin user created');
    }
  } catch (error) {
    console.error('Initialization error:', error);
    process.exit(1);
  }
}

initializeData();

// Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });
  
  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    
    try {
      const admin = await Admin.findById(decoded.id).select('-password');
      if (!admin) return res.status(403).json({ error: 'Admin account not found' });
      
      req.user = admin;
      next();
    } catch (error) {
      console.error('Admin verification error:', error);
      res.status(500).json({ error: 'Server error during authentication' });
    }
  });
}

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  }
  next();
}

async function notifyAdminAboutNewRegistration(contestant) {
  try {
    const mailOptions = {
      from: `"Mr & Miss Embakasi" <${SMTP_USER}>`,
      to: ADMIN_EMAIL,
      subject: 'New Contestant Registration - Approval Required',
      html: `
        <h2>New Contestant Registration</h2>
        <p>A new contestant has registered and requires your approval:</p>
        <ul>
          <li><strong>Name:</strong> ${contestant.name}</li>
          <li><strong>Category:</strong> ${contestant.category === 'mr' ? 'Mr. Embakasi' : 'Miss Embakasi'}</li>
          <li><strong>Phone:</strong> ${contestant.phone}</li>
          ${contestant.email ? `<li><strong>Email:</strong> ${contestant.email}</li>` : ''}
        </ul>
        <p>Please review and approve/reject this registration in the admin panel:</p>
        <a href="${FRONTEND_URL}/admin/contestants/${contestant._id}" style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">
          Review Contestant
        </a>
        <p>Thank you,</p>
        <p>Mr & Miss Embakasi System</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Admin notification email sent');
  } catch (error) {
    console.error('Error sending admin notification:', error);
  }
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
      const admin = await Admin.findOne({ email }).select('+password');
      
      if (!admin || !await bcrypt.compare(password, admin.password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Update last login
      admin.lastLogin = new Date();
      await admin.save();
      
      const token = jwt.sign({ id: admin._id, email: admin.email, role: admin.role }, JWT_SECRET, { expiresIn: '4h' });
      
      res.json({ 
        token,
        admin: {
          id: admin._id,
          email: admin.email,
          role: admin.role,
          lastLogin: admin.lastLogin
        }
      });
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
    body('name').trim().isLength({ min: 3, max: 50 }).escape(),
    body('phone').matches(/^254[17]\d{8}$/),
    body('email').optional().isEmail().normalizeEmail(),
    body('category').isIn(['mr', 'miss']),
    body('bio').optional().isLength({ max: 500 }).escape()
  ],
  async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Remove uploaded file if validation fails
      if (req.file) {
        fs.unlinkSync(path.join(UPLOAD_DIR, req.file.filename));
      }
      return res.status(400).json({ 
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a photo' });
    }

    try {
      const { name, phone, email, category, bio } = req.body;
      
      // Check for existing contestant with same phone or email
      const existingContestant = await Contestant.findOne({ 
        $or: [{ phone }, { email: email || null }],
        status: { $ne: 'rejected' }
      });

      if (existingContestant) {
        fs.unlinkSync(path.join(UPLOAD_DIR, req.file.filename));
        return res.status(400).json({ 
          error: 'A contestant with this phone or email already exists'
        });
      }

      // Create photo URL
      const photoUrl = '/uploads/' + req.file.filename;

      // Create new contestant
      const contestant = new Contestant({
        name,
        phone,
        email: email || undefined,
        category,
        bio: bio || undefined,
        photo: photoUrl,
        status: 'pending'
      });

      await contestant.save();

      // Notify admin about new registration
      await notifyAdminAboutNewRegistration(contestant);

      res.status(201).json({ 
        success: true,
        message: 'Registration submitted successfully. Your application is under review.',
        data: {
          id: contestant._id,
          name: contestant.name,
          photo: photoUrl,
          category: contestant.category,
          status: contestant.status
        }
      });

    } catch (error) {
      // Clean up file if error occurs
      if (req.file) {
        fs.unlinkSync(path.join(UPLOAD_DIR, req.file.filename));
      }
      console.error('Registration error:', error);
      res.status(500).json({ 
        error: 'Error processing registration',
        details: error.message
      });
    }
  }
);

// Get Contestants
app.get('/api/contestants', async (req, res) => {
  try {
    const { status, category, search, page = 1, limit = 10 } = req.query;
    const query = {};
    
    if (status) query.status = status;
    if (category) query.category = category;
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { votes: -1, createdAt: -1 }
    };
    
    const result = await Contestant.paginate(query, options);
    
    res.json({
      success: true,
      data: {
        contestants: result.docs,
        total: result.totalDocs,
        pages: result.totalPages,
        page: result.page
      }
    });
  } catch (error) {
    console.error('Error fetching contestants:', error);
    res.status(500).json({ 
      error: 'Error fetching contestants',
      details: error.message
    });
  }
});

// Get Contestant by ID
app.get('/api/contestants/:id', async (req, res) => {
  try {
    const contestant = await Contestant.findById(req.params.id);
    
    if (!contestant) {
      return res.status(404).json({ error: 'Contestant not found' });
    }
    
    res.json({
      success: true,
      data: contestant
    });
  } catch (error) {
    console.error('Error fetching contestant:', error);
    res.status(500).json({ 
      error: 'Error fetching contestant',
      details: error.message
    });
  }
});

// Admin-only endpoints
app.use('/api/admin', authenticateToken);

// Get Admin Dashboard Stats
app.get('/api/admin/dashboard', async (req, res) => {
  try {
    const [pendingCount, approvedCount, rejectedCount, totalVotes, recentVotes] = await Promise.all([
      Contestant.countDocuments({ status: 'pending' }),
      Contestant.countDocuments({ status: 'approved' }),
      Contestant.countDocuments({ status: 'rejected' }),
      Contestant.aggregate([{ $group: { _id: null, total: { $sum: '$votes' } }}]),
      VoteTransaction.find().sort({ createdAt: -1 }).limit(5).populate('contestantId', 'name photo')
    ]);
    
    res.json({
      success: true,
      data: {
        counts: {
          pending: pendingCount,
          approved: approvedCount,
          rejected: rejectedCount
        },
        totalVotes: totalVotes[0]?.total || 0,
        recentVotes
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ 
      error: 'Error fetching dashboard data',
      details: error.message
    });
  }
});

// Approve Contestant
app.patch('/api/admin/contestants/:id/approve', 
  [
    body('adminNotes').optional().isString().escape()
  ],
  validateRequest,
  async (req, res) => {
    try {
      const contestant = await Contestant.findByIdAndUpdate(
        req.params.id,
        { 
          status: 'approved',
          adminNotes: req.body.adminNotes,
          approvedBy: req.user._id,
          approvedOn: new Date()
        },
        { new: true }
      );

      if (!contestant) {
        return res.status(404).json({ error: 'Contestant not found' });
      }

      res.json({ 
        success: true,
        message: 'Contestant approved successfully',
        data: contestant
      });
    } catch (error) {
      console.error('Approval error:', error);
      res.status(400).json({ 
        error: 'Error approving contestant',
        details: error.message
      });
    }
  }
);

// Reject Contestant
app.patch('/api/admin/contestants/:id/reject', 
  [
    body('rejectionReason').isString().trim().notEmpty().escape()
  ],
  validateRequest,
  async (req, res) => {
    try {
      const contestant = await Contestant.findByIdAndUpdate(
        req.params.id,
        { 
          status: 'rejected',
          rejectionReason: req.body.rejectionReason,
          approvedBy: req.user._id,
          approvedOn: new Date()
        },
        { new: true }
      );

      if (!contestant) {
        return res.status(404).json({ error: 'Contestant not found' });
      }

      res.json({ 
        success: true,
        message: 'Contestant rejected',
        data: contestant
      });
    } catch (error) {
      console.error('Rejection error:', error);
      res.status(400).json({ 
        error: 'Error rejecting contestant',
        details: error.message
      });
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
    
    res.json({ 
      success: true,
      message: 'Contestant deleted successfully'
    });
  } catch (error) {
    console.error('Deletion error:', error);
    res.status(400).json({ 
      error: 'Error deleting contestant',
      details: error.message
    });
  }
});

// Voting Endpoints
app.post('/api/votes',
  [
    body('contestantId').isMongoId(),
    body('contestantName').isString().trim().escape(),
    body('votes').isInt({ min: 1, max: 100 }),
    body('amount').isInt({ min: 20 }),
    body('phone').matches(/^254[17]\d{8}$/)
  ],
  validateRequest,
  async (req, res) => {
    try {
      // Check if voting is enabled
      const votingStatus = await Config.findOne({ key: 'votingEnabled' });
      if (!votingStatus?.value) {
        return res.status(403).json({ 
          error: 'Voting is currently disabled by administrators' 
        });
      }

      // Check if contestant exists and is approved
      const contestant = await Contestant.findById(req.body.contestantId);
      if (!contestant || contestant.status !== 'approved') {
        return res.status(400).json({ 
          error: 'Invalid contestant or contestant not approved' 
        });
      }

      // Create vote transaction
      const transaction = new VoteTransaction({
        contestantId: contestant._id,
        contestantName: contestant.name,
        votes: req.body.votes,
        amount: req.body.amount,
        phone: req.body.phone,
        paymentStatus: 'completed' // In a real app, this would be set after payment verification
      });

      await transaction.save();
      
      // Update contestant votes
      contestant.votes += req.body.votes;
      await contestant.save();
      
      res.status(201).json({ 
        success: true,
        message: 'Vote recorded successfully',
        data: {
          transactionId: transaction._id,
          contestant: {
            id: contestant._id,
            name: contestant.name,
            votes: contestant.votes
          }
        }
      });
    } catch (error) {
      console.error('Voting error:', error);
      res.status(400).json({ 
        error: 'Error processing vote',
        details: error.message
      });
    }
  }
);

// Get Vote Transactions
app.get('/api/votes', async (req, res) => {
  try {
    const { contestantId, phone, page = 1, limit = 20 } = req.query;
    const query = {};
    
    if (contestantId) query.contestantId = contestantId;
    if (phone) query.phone = phone;
    
    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 },
      populate: {
        path: 'contestantId',
        select: 'name photo category'
      }
    };
    
    const result = await VoteTransaction.paginate(query, options);
    
    res.json({
      success: true,
      data: {
        transactions: result.docs,
        total: result.totalDocs,
        pages: result.totalPages,
        page: result.page
      }
    });
  } catch (error) {
    console.error('Error fetching votes:', error);
    res.status(500).json({ 
      error: 'Error fetching vote transactions',
      details: error.message
    });
  }
});

// Voting Configuration
app.get('/api/config/voting-status', async (req, res) => {
  try {
    const config = await Config.findOne({ key: 'votingEnabled' });
    res.json({ 
      success: true,
      data: {
        votingEnabled: config?.value ?? true
      }
    });
  } catch (error) {
    console.error('Config error:', error);
    res.status(500).json({ 
      error: 'Error fetching voting status',
      details: error.message
    });
  }
});

app.patch('/api/admin/config/voting-status',
  [
    body('votingEnabled').isBoolean()
  ],
  validateRequest,
  async (req, res) => {
    try {
      const config = await Config.findOneAndUpdate(
        { key: 'votingEnabled' },
        { 
          value: req.body.votingEnabled,
          updatedBy: req.user._id
        },
        { upsert: true, new: true }
      );
      
      res.json({ 
        success: true,
        message: 'Voting status updated',
        data: config
      });
    } catch (error) {
      console.error('Config update error:', error);
      res.status(500).json({ 
        error: 'Error updating voting status',
        details: error.message
      });
    }
  }
);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  // Handle file upload errors
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ 
      error: 'File upload error',
      details: err.code === 'LIMIT_FILE_SIZE' ? 
        'File size too large. Maximum 2MB allowed.' : 
        'Error processing file upload'
    });
  }
  
  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Admin panel: ${FRONTEND_URL}/admin`);
  console.log(`Upload directory: ${path.resolve(UPLOAD_DIR)}`);
});