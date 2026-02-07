const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Grace Period Checker
const GracePeriodChecker = require('./grace_period_checker');

const db = require('./config/database');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const vehicleRoutes = require('./routes/vehicles');
const parkingRoutes = require('./routes/parking');
const parkingAreasRoutes = require('./routes/parking-areas');
const qrRoutes = require('./routes/qr');
const paymentRoutes = require('./routes/payments');
const favoriteRoutes = require('./routes/favorites');
const historyRoutes = require('./routes/history');
const subscriptionRoutes = require('./routes/subscriptions');
const attendantRoutes = require('./routes/attendant');
const paypalRoutes = require('./routes/paypal');
const capacityRoutes = require('./routes/capacity-management');
const feedbackRoutes = require('./routes/feedback_v2');

const app = express();
const PORT = process.env.PORT || 3000;

// Basic middleware with performance optimizations
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for development
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: true, // Allow all origins for debugging
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ 
  limit: '10mb',
  strict: false // Relax JSON parsing for better performance
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb',
  parameterLimit: 1000
}));

// Add response time middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000) { // Log slow requests
      console.warn(`⚠️ Slow request: ${req.method} ${req.path} - ${duration}ms`);
    }
  });
  next();
});

// Serve static files (QR codes)
app.use('/public', express.static(path.join(__dirname, 'public')));

// Serve profile pictures (explicit handler to avoid static middleware issues)
const profilePicturesDir = path.join(__dirname, 'uploads', 'profile-pictures');

app.use('/uploads/profile-pictures', express.static(profilePicturesDir));

app.get('/uploads/profile-pictures/:filename', (req, res, next) => {
  const { filename } = req.params;
  const filePath = path.join(profilePicturesDir, filename);

  if (fs.existsSync(filePath)) {
    console.log(`📸 Serving profile picture: ${filename}`);
    return res.sendFile(filePath);
  }

  console.warn(`⚠️ Profile picture not found: ${filename}`);
  return res.status(404).json({
    success: false,
    message: 'Profile picture not found',
    filename
  });
});

// Health check endpoint (no database required)
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: '1.0.0'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/parking', parkingRoutes);
app.use('/api/parking-areas', parkingAreasRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/attendant', attendantRoutes);
app.use('/api/paypal', paypalRoutes);
app.use('/api/capacity', capacityRoutes);
app.use('/api/feedback', feedbackRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: 'Server Error'
  });
});

// Start server immediately - listen on all network interfaces for external devices
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Tapparkuser Backend Server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🌐 Network access: http://192.168.1.5:${PORT}/health`);
  console.log(`📋 API Documentation: http://localhost:${PORT}/api`);
  console.log('💡 Database will connect when first API call is made');
});

// Database will connect automatically on first API call - no startup delay
console.log('💡 Database connects automatically on first API call');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await db.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await db.disconnect();
  process.exit(0);
});

// Grace Period Checker - Simple Direct Approach
console.log('🔧 Setting up grace period checker...');

let isGracePeriodCheckRunning = false;

const ensureDbPool = async () => {
  if (!db.connection) {
    await db.connect();
  }
  return db.connection;
};

const runGracePeriodCheck = async () => {
  if (isGracePeriodCheckRunning) {
    console.log('⏳ Grace period check already running. Skipping this interval.');
    return;
  }

  isGracePeriodCheckRunning = true;

  try {
    console.log('🧪 Running simple grace period check...');

    // Get grace period from environment or default to 15 minutes
    const GRACE_PERIOD_MINUTES = parseInt(process.env.GRACE_PERIOD_MINUTES) || 15;
    console.log(`⏰ Using grace period: ${GRACE_PERIOD_MINUTES} minutes`);

    const pool = await ensureDbPool();

    // Find expired reservations
    const [expiredReservations] = await pool.execute(`
      SELECT reservation_id, parking_spots_id, parking_section_id
      FROM reservations 
      WHERE booking_status = 'reserved' 
        AND start_time IS NULL 
        AND TIMESTAMPDIFF(MINUTE, time_stamp, NOW()) >= ?
    `, [GRACE_PERIOD_MINUTES]);

    console.log(`📊 Found ${expiredReservations.length} expired reservations`);

    if (expiredReservations.length > 0) {
      for (const reservation of expiredReservations) {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();

          await connection.execute(
            'UPDATE reservations SET booking_status = ?, waiting_end_time = NOW(), updated_at = NOW() WHERE reservation_id = ?',
            ['invalid', reservation.reservation_id]
          );

          if (reservation.parking_spots_id !== 0) {
            await connection.execute(
              'UPDATE parking_spot SET status = ?, is_occupied = 0 WHERE parking_spot_id = ?',
              ['available', reservation.parking_spots_id]
            );
          }

          if (reservation.parking_section_id) {
            await connection.execute(
              'UPDATE parking_section SET reserved_count = GREATEST(reserved_count - 1, 0) WHERE parking_section_id = ?',
              [reservation.parking_section_id]
            );
            console.log(`✅ Decremented reserved_count for section ${reservation.parking_section_id}`);
          }

          await connection.commit();
          console.log(`✅ Expired reservation #${reservation.reservation_id}`);
        } catch (error) {
          await connection.rollback();
          console.error(`❌ Failed to expire reservation #${reservation.reservation_id}:`, error.message);
        } finally {
          connection.release();
        }
      }
    }

    console.log('✅ Simple grace period check completed');

  } catch (error) {
    console.error('❌ Simple grace period check failed:', error.message);
    console.error('❌ Full error:', error);
  } finally {
    isGracePeriodCheckRunning = false;
  }
};

// Test run immediately
setTimeout(runGracePeriodCheck, 2000);

// Schedule every 30 seconds for testing (change to 5 * 60 * 1000 for production)
const gracePeriodInterval = setInterval(() => {
  console.log('⏰ Interval triggered - running grace period check...');
  runGracePeriodCheck();
}, 30 * 1000);

console.log('⏰ Simple grace period checker scheduled to run every 30 seconds');
console.log('⏰ Interval ID:', gracePeriodInterval);

// Clean up on server shutdown
process.on('SIGTERM', () => {
  clearInterval(gracePeriodInterval);
});

process.on('SIGINT', () => {
  clearInterval(gracePeriodInterval);
});
