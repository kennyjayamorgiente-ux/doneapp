// Simple debug script to test grace period modal logic
const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'merge1',
  charset: 'utf8mb4',
  timezone: '+00:00'
};

async function debugGracePeriod() {
  console.log('🔍 Debugging Grace Period Implementation...\n');
  
  try {
    const connection = await mysql.createConnection(dbConfig);
    
    // 1. Check current reservations
    console.log('📋 Current reservations:');
    const [reservations] = await connection.execute(`
      SELECT reservation_id, booking_status, start_time, created_at, 
             TIMESTAMPDIFF(MINUTE, created_at, NOW()) as minutes_old
      FROM reservations 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    if (reservations.length === 0) {
      console.log('   No reservations found');
    } else {
      reservations.forEach(res => {
        const status = res.booking_status === 'reserved' ? '⏳' : 
                      res.booking_status === 'active' ? '🟢' : 
                      res.booking_status === 'invalid' ? '❌' : '❓';
        console.log(`   ${status} Reservation #${res.reservation_id}: ${res.booking_status}, ${res.minutes_old} minutes old`);
      });
    }
    
    // 2. Test the grace period query
    console.log('\n🔍 Testing grace period query:');
    const [expiredReservations] = await connection.execute(`
      SELECT 
        r.reservation_id,
        r.user_id,
        r.parking_spots_id,
        r.created_at,
        ps.spot_number,
        ps.parking_section_id,
        pa.parking_area_name,
        CONCAT(u.first_name, ' ', u.last_name) AS user_name,
        v.plate_number,
        TIMESTAMPDIFF(MINUTE, r.created_at, NOW()) as minutes_old
      FROM reservations r
      JOIN parking_spot ps ON r.parking_spots_id = ps.parking_spot_id
      LEFT JOIN parking_section psec ON ps.parking_section_id = psec.parking_section_id
      LEFT JOIN parking_area pa ON psec.parking_area_id = pa.parking_area_id
      JOIN users u ON r.user_id = u.user_id
      LEFT JOIN vehicles v ON r.vehicle_id = v.vehicle_id
      WHERE r.booking_status = 'reserved'
        AND r.start_time IS NULL
        AND TIMESTAMPDIFF(MINUTE, r.created_at, NOW()) >= 1
    `);
    
    if (expiredReservations.length === 0) {
      console.log('   ✅ No expired reservations found (grace period working correctly)');
    } else {
      console.log(`   ⚠️ Found ${expiredReservations.length} expired reservations:`);
      expiredReservations.forEach(res => {
        console.log(`      - Reservation #${res.reservation_id}: ${res.user_name}, Spot ${res.spot_number}, ${res.minutes_old} minutes old`);
      });
    }
    
    // 3. Create a test reservation if needed
    console.log('\n🧪 Creating test reservation (2 minutes old for 1-minute grace period)');
    const createdTime = new Date(Date.now() - (2 * 60 * 1000));
    
    // Find an available spot
    const [spots] = await connection.execute(
      `SELECT parking_spot_id, spot_number, parking_section_id 
       FROM parking_spot 
       WHERE status = 'free' 
       LIMIT 1`
    );
    
    if (spots.length === 0) {
      console.log('   ❌ No available spots for testing');
    } else {
      const spot = spots[0];
      
      // Find a user
      const [users] = await connection.execute(
        `SELECT user_id FROM users LIMIT 1`
      );
      
      if (users.length === 0) {
        console.log('   ❌ No users found for testing');
      } else {
        const user = users[0];
        
        // Create expired test reservation
        const [result] = await connection.execute(`
          INSERT INTO reservations 
          (user_id, parking_spots_id, booking_status, start_time, created_at, updated_at, spot_number, parking_section_id)
          VALUES (?, ?, 'reserved', NULL, ?, ?, ?, ?)
        `, [user.user_id, spot.parking_spot_id, createdTime, createdTime, spot.spot_number, spot.parking_section_id]);
        
        // Update spot to reserved
        await connection.execute(
          `UPDATE parking_spot SET status = 'reserved' WHERE parking_spot_id = ?`,
          [spot.parking_spot_id]
        );
        
        console.log(`   ✅ Created test reservation #${result.insertId} (20 minutes old)`);
        
        // Test the grace period query again
        console.log('\n🔍 Testing grace period query with test reservation:');
        const [testExpired] = await connection.execute(`
          SELECT reservation_id, booking_status, 
                 TIMESTAMPDIFF(MINUTE, created_at, NOW()) as minutes_old
          FROM reservations 
          WHERE reservation_id = ?
        `, [result.insertId]);
        
        if (testExpired.length > 0) {
          const test = testExpired[0];
          console.log(`   📊 Test reservation: ${test.booking_status}, ${test.minutes_old} minutes old`);
          
          if (test.minutes_old >= 1) {
            console.log(`   ✅ Test reservation should be expired by grace period checker`);
          } else {
            console.log(`   ⏳ Test reservation not yet expired (needs 1+ minutes)`);
          }
        }
      }
    }
    
    await connection.end();
    console.log('\n🎯 Debug completed!');
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

// Run the debug
debugGracePeriod();
