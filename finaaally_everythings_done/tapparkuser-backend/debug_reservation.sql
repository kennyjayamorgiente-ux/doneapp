-- Debug script to check reservation data
-- Run this to see what's actually stored for your motorcycle reservation

-- Check the specific reservation (replace 285 with your actual reservation_id)
SELECT 
  r.reservation_id,
  r.parking_spots_id,
  r.parking_section_id,
  r.spot_number,
  r.booking_status,
  r.user_id,
  v.plate_number,
  v.vehicle_type,
  ps.section_name,
  ps.capacity,
  ps.reserved_count,
  ps.parked_count
FROM reservations r
JOIN vehicles v ON r.vehicle_id = v.vehicle_id
JOIN parking_section ps ON r.parking_section_id = ps.parking_section_id
WHERE r.reservation_id = 285  -- Replace with your actual reservation_id
  AND r.parking_spots_id = 0;  -- Only capacity sections

-- Check all motorcycle capacity section reservations
SELECT 
  r.reservation_id,
  r.parking_spots_id,
  r.parking_section_id,
  r.spot_number,
  r.booking_status,
  v.plate_number,
  ps.section_name
FROM reservations r
JOIN vehicles v ON r.vehicle_id = v.vehicle_id
JOIN parking_section ps ON r.parking_section_id = ps.parking_section_id
WHERE r.parking_spots_id = 0
  AND v.vehicle_type = 'motorcycle'
ORDER BY r.reservation_id DESC
LIMIT 10;
