// Quick test to manually check and expire reservations
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

async function quickTest() {
  console.log('🔍 Quick Grace Period Test\n');
  
  try {
    const connection = await mysql.createConnection(dbConfig);
    
    // 1. Check current reservations
    console.log('📋 Current reservations:');
    const [reservations] = await connection.execute(`
      SELECT reservation_id, booking_status, start_time, time_stamp,
             TIMESTAMPDIFF(MINUTE, time_stamp, NOW()) as minutes_old
      FROM reservations 
      ORDER BY time_stamp DESC 
      LIMIT 5
    `);
    
    if (reservations.length === 0) {
      console.log('   No reservations found');
    } else {
      reservations.forEach(res => {
        const status = res.booking_status === 'reserved' ? '⏳' : 
                      res.booking_status === 'active' ? '🟢' : 
                      res.booking_status === 'invalid' ? '❌' : '❓';
        console.log(`   ${status} #${res.reservation_id}: ${res.booking_status}, ${res.minutes_old} minutes old`);
      });
    }
    
    // 2. Find reservations that should be expired (1+ minute old, reserved, no start_time)
    console.log('\n🎯 Finding reservations to expire:');
    const [toExpire] = await connection.execute(`
      SELECT reservation_id, booking_status, time_stamp,
             TIMESTAMPDIFF(MINUTE, time_stamp, NOW()) as minutes_old
      FROM reservations 
      WHERE booking_status = 'reserved' 
        AND start_time IS NULL 
        AND TIMESTAMPDIFF(MINUTE, time_stamp, NOW()) >= 1
    `);
    
    if (toExpire.length === 0) {
      console.log('   ✅ No reservations need expiration (all good!)');
    } else {
      console.log(`   ⚠️ Found ${toExpire.length} reservations to expire:`);
      toExpire.forEach(res => {
        console.log(`      - #${res.reservation_id}: ${res.minutes_old} minutes old`);
      });
      
      // 3. Manually expire the first one for testing
      if (toExpire.length > 0) {
        const target = toExpire[0];
        console.log(`\n🔧 Manually expiring reservation #${target.reservation_id}...`);
        
        await connection.beginTransaction();
        try {
          // Mark as invalid
          await connection.execute(
            'UPDATE reservations SET booking_status = ?, updated_at = NOW() WHERE reservation_id = ?',
            ['invalid', target.reservation_id]
          );
          
          // Get spot info to free it
          const [spotInfo] = await connection.execute(
            'SELECT parking_spots_id FROM reservations WHERE reservation_id = ?',
            [target.reservation_id]
          );
          
          if (spotInfo.length > 0) {
            // Free the spot
            await connection.execute(
              'UPDATE parking_spot SET status = ?, is_occupied = 0, occupied_by = NULL, occupied_at = NULL WHERE parking_spot_id = ?',
              ['free', spotInfo[0].parking_spots_id]
            );
          }
          
          await connection.commit();
          console.log(`   ✅ Successfully expired reservation #${target.reservation_id}`);
          
          // 4. Verify the change
          const [verify] = await connection.execute(
            'SELECT booking_status FROM reservations WHERE reservation_id = ?',
            [target.reservation_id]
          );
          
          if (verify.length > 0) {
            console.log(`   📊 New status: ${verify[0].booking_status}`);
          }
          
        } catch (error) {
          await connection.rollback();
          console.error('   ❌ Error expiring reservation:', error.message);
        }
      }
    }
    
    await connection.end();
    console.log('\n🎯 Quick test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

quickTest();
