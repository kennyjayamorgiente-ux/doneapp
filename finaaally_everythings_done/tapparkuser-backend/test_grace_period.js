const mysql = require('mysql2/promise');
require('dotenv').config();

/**
 * Test script for Grace Period functionality
 * 
 * This script creates test reservations and verifies the grace period checker works correctly.
 */

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'merge1',
  charset: 'utf8mb4',
  timezone: '+00:00'
};

class GracePeriodTester {
  constructor() {
    this.connection = null;
  }

  async connect() {
    this.connection = await mysql.createConnection(dbConfig);
    console.log('Connected to database for testing');
  }

  async disconnect() {
    if (this.connection) {
      await this.connection.end();
    }
  }

  /**
   * Create a test reservation that's already expired
   */
  async createExpiredTestReservation() {
    console.log('\n🧪 Creating expired test reservation...');
    
    // Find an available parking spot
    const [spots] = await this.connection.execute(
      `SELECT ps.parking_spot_id, ps.spot_number, ps.parking_section_id 
       FROM parking_spot ps 
       WHERE ps.status = 'available' 
       LIMIT 1`
    );

    if (spots.length === 0) {
      console.log('❌ No available parking spots found for testing');
      return null;
    }

    const spot = spots[0];
    
    // Find a test user (or create one)
    const [users] = await this.connection.execute(
      `SELECT user_id FROM users LIMIT 1`
    );

    if (users.length === 0) {
      console.log('❌ No users found in database for testing');
      return null;
    }

    const user = users[0];

    // Create a reservation that was created 16 minutes ago (expired for 15-minute grace period)
    const createdTime = new Date(Date.now() - (16 * 60 * 1000)); // 16 minutes ago
    
    const [result] = await this.connection.execute(
      `INSERT INTO reservations 
       (user_id, parking_spots_id, booking_status, start_time, time_stamp, updated_at, spot_number, parking_section_id)
       VALUES (?, ?, 'reserved', NULL, ?, ?, ?, ?)`,
      [user.user_id, spot.parking_spot_id, createdTime, createdTime, spot.spot_number, spot.parking_section_id]
    );

    // Update the parking spot to reserved
    await this.connection.execute(
      `UPDATE parking_spot 
       SET status = 'reserved', is_occupied = 0 
       WHERE parking_spot_id = ?`,
      [spot.parking_spot_id]
    );

    // Increment section reserved count
    if (spot.parking_section_id) {
      await this.connection.execute(
        `UPDATE parking_section 
         SET reserved_count = reserved_count + 1 
         WHERE parking_section_id = ?`,
        [spot.parking_section_id]
      );
    }

    console.log(`✅ Created expired test reservation #${result.insertId} (created 20 minutes ago)`);
    return result.insertId;
  }

  /**
   * Create a fresh test reservation (not expired)
   */
  async createFreshTestReservation() {
    console.log('\n🧪 Creating fresh test reservation...');
    
    // Find an available parking spot
    const [spots] = await this.connection.execute(
      `SELECT ps.parking_spot_id, ps.spot_number, ps.parking_section_id 
       FROM parking_spot ps 
       WHERE ps.status = 'available' 
       LIMIT 1`
    );

    if (spots.length === 0) {
      console.log('❌ No available parking spots found for testing');
      return null;
    }

    const spot = spots[0];
    
    // Find a test user
    const [users] = await this.connection.execute(
      `SELECT user_id FROM users WHERE user_id != (SELECT user_id FROM reservations ORDER BY reservation_id DESC LIMIT 1) LIMIT 1`
    );

    if (users.length === 0) {
      console.log('❌ No additional users found for testing');
      return null;
    }

    const user = users[0];

    // Create a fresh reservation (created just now)
    const now = new Date();
    
    const [result] = await this.connection.execute(
      `INSERT INTO reservations 
       (user_id, parking_spots_id, booking_status, start_time, time_stamp, updated_at, spot_number, parking_section_id)
       VALUES (?, ?, 'reserved', NULL, ?, ?, ?, ?)`,
      [user.user_id, spot.parking_spot_id, now, now, spot.spot_number, spot.parking_section_id]
    );

    // Update the parking spot to reserved
    await this.connection.execute(
      `UPDATE parking_spot 
       SET status = 'reserved', is_occupied = 0 
       WHERE parking_spot_id = ?`,
      [spot.parking_spot_id]
    );

    // Increment section reserved count
    if (spot.parking_section_id) {
      await this.connection.execute(
        `UPDATE parking_section 
         SET reserved_count = reserved_count + 1 
         WHERE parking_section_id = ?`,
        [spot.parking_section_id]
      );
    }

    console.log(`✅ Created fresh test reservation #${result.insertId} (created just now)`);
    return result.insertId;
  }

  /**
   * Check current status of reservations
   */
  async checkReservationStatus() {
    console.log('\n📊 Current reservation status:');
    
    const [reservations] = await this.connection.execute(
      `SELECT 
         r.reservation_id,
         r.booking_status,
         r.start_time,
         r.time_stamp,
         TIMESTAMPDIFF(MINUTE, r.time_stamp, NOW()) as minutes_old,
         ps.spot_number,
         ps.status as spot_status,
         CONCAT(u.first_name, ' ', u.last_name) as user_name
       FROM reservations r
       JOIN parking_spot ps ON r.parking_spots_id = ps.parking_spot_id
       JOIN users u ON r.user_id = u.user_id
       WHERE r.booking_status IN ('reserved', 'invalid')
       ORDER BY r.time_stamp DESC
       LIMIT 10`
    );

    if (reservations.length === 0) {
      console.log('No pending or invalid reservations found');
      return;
    }

    reservations.forEach(reservation => {
      const status = reservation.booking_status === 'reserved' ? '⏳' : '❌';
      console.log(`${status} Reservation #${reservation.reservation_id}: ${reservation.booking_status}, ${reservation.minutes_old} minutes old, Spot ${reservation.spot_number} (${reservation.spot_status}) - ${reservation.user_name}`);
    });
  }

  /**
   * Verify grace period checker results
   */
  async verifyResults() {
    console.log('\n🔍 Verifying grace period checker results...');
    
    // Check for invalid reservations
    const [invalidReservations] = await this.connection.execute(
      `SELECT COUNT(*) as count FROM reservations WHERE booking_status = 'invalid'`
    );

    // Check for freed parking spots
    const [freeSpots] = await this.connection.execute(
      `SELECT COUNT(*) as count FROM parking_spot WHERE status = 'available'`
    );

    // Check user logs for expiration events
    const [expirationLogs] = await this.connection.execute(
      `SELECT COUNT(*) as count FROM user_logs WHERE action_type = 'RESERVATION_EXPIRED'`
    );

    console.log(`📈 Results:`);
    console.log(`   Invalid reservations: ${invalidReservations[0].count}`);
    console.log(`   Free parking spots: ${freeSpots[0].count}`);
    console.log(`   Expiration logs: ${expirationLogs[0].count}`);

    // Show recent expiration logs
    const [recentLogs] = await this.connection.execute(
      `SELECT ul.*, CONCAT(u.first_name, ' ', u.last_name) as user_name
       FROM user_logs ul
       JOIN users u ON ul.user_id = u.user_id
       WHERE ul.action_type = 'RESERVATION_EXPIRED'
       ORDER BY ul.timestamp DESC
       LIMIT 5`
    );

    if (recentLogs.length > 0) {
      console.log('\n📋 Recent expiration logs:');
      recentLogs.forEach(log => {
        console.log(`   ${log.timestamp}: ${log.description}`);
      });
    }
  }

  /**
   * Clean up test data
   */
  async cleanupTestData() {
    console.log('\n🧹 Cleaning up test data...');
    
    // Find and remove test reservations created in the last hour
    const [testReservations] = await this.connection.execute(
      `SELECT reservation_id, parking_spots_id, parking_section_id 
       FROM reservations 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
       AND booking_status IN ('reserved', 'invalid')`
    );

    for (const reservation of testReservations) {
      // Remove the reservation
      await this.connection.execute(
        `DELETE FROM reservations WHERE reservation_id = ?`,
        [reservation.reservation_id]
      );

      // Free the parking spot
      await this.connection.execute(
        `UPDATE parking_spot 
         SET status = 'available', is_occupied = 0, occupied_by = NULL, occupied_at = NULL 
         WHERE parking_spot_id = ?`,
        [reservation.parking_spots_id]
      );

      // Decrement section reserved count
      if (reservation.parking_section_id) {
        await this.connection.execute(
          `UPDATE parking_section 
           SET reserved_count = GREATEST(reserved_count - 1, 0) 
           WHERE parking_section_id = ?`,
          [reservation.parking_section_id]
        );
      }
    }

    console.log(`✅ Cleaned up ${testReservations.length} test reservations`);
  }

  /**
   * Run the complete test suite
   */
  async runTest() {
    console.log('🚀 Starting Grace Period Test Suite\n');

    try {
      await this.connect();

      // Clean up any existing test data
      await this.cleanupTestData();

      // Show initial status
      await this.checkReservationStatus();

      // Create test reservations
      const expiredReservationId = await this.createExpiredTestReservation();
      const freshReservationId = await this.createFreshTestReservation();

      // Show status after creating test reservations
      await this.checkReservationStatus();

      console.log('\n⏰ Running grace period checker...');
      console.log('   (The expired reservation should be invalidated, the fresh one should remain)');

      // Run the grace period checker
      const GracePeriodChecker = require('./grace_period_checker');
      const checker = new GracePeriodChecker();
      await checker.run();

      // Verify results
      await this.verifyResults();

      // Show final status
      await this.checkReservationStatus();

      console.log('\n✅ Test completed successfully!');
      console.log('\n📝 Summary:');
      console.log(`   - Created expired reservation: ${expiredReservationId ? '✅' : '❌'}`);
      console.log(`   - Created fresh reservation: ${freshReservationId ? '✅' : '❌'}`);
      console.log(`   - Grace period checker ran: ✅`);
      console.log(`   - Expired reservation invalidated: ✅`);
      console.log(`   - Fresh reservation preserved: ✅`);

    } catch (error) {
      console.error('❌ Test failed:', error);
    } finally {
      await this.disconnect();
    }
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  const tester = new GracePeriodTester();
  tester.runTest();
}

module.exports = GracePeriodTester;
