-- Capacity Count Debug Script
-- Run this to check current capacity counts and verify they're correct

-- Check current section counts
SELECT 
  ps.parking_section_id,
  ps.section_name,
  ps.vehicle_type,
  ps.capacity,
  ps.reserved_count,
  ps.parked_count,
  (ps.capacity - ps.reserved_count - ps.parked_count) as available_capacity,
  (ps.reserved_count + ps.parked_count) as total_used
FROM parking_section ps
WHERE ps.vehicle_type = 'motorcycle'
ORDER BY ps.section_name;

-- Check actual reservation counts by section
SELECT 
  r.parking_section_id,
  ps.section_name,
  COUNT(*) as actual_reservations,
  SUM(CASE WHEN r.booking_status = 'reserved' THEN 1 ELSE 0 END) as reserved_count,
  SUM(CASE WHEN r.booking_status = 'active' THEN 1 ELSE 0 END) as active_count,
  SUM(CASE WHEN r.booking_status = 'completed' THEN 1 ELSE 0 END) as completed_count,
  SUM(CASE WHEN r.booking_status = 'invalid' THEN 1 ELSE 0 END) as invalid_count
FROM reservations r
JOIN parking_section ps ON r.parking_section_id = ps.parking_section_id
WHERE r.parking_spots_id = 0  -- Only capacity sections
  AND ps.vehicle_type = 'motorcycle'
GROUP BY r.parking_section_id, ps.section_name
ORDER BY ps.section_name;

-- Find discrepancies
SELECT 
  ps.parking_section_id,
  ps.section_name,
  ps.reserved_count as section_reserved,
  ps.parked_count as section_parked,
  COALESCE(reservation_counts.reserved_count, 0) as actual_reserved,
  COALESCE(reservation_counts.active_count, 0) as actual_active,
  CASE 
    WHEN ps.reserved_count != COALESCE(reservation_counts.reserved_count, 0) THEN 'RESERVED_COUNT_MISMATCH'
    WHEN ps.parked_count != COALESCE(reservation_counts.active_count, 0) THEN 'PARKED_COUNT_MISMATCH'
    ELSE 'OK'
  END as status
FROM parking_section ps
LEFT JOIN (
  SELECT 
    r.parking_section_id,
    SUM(CASE WHEN r.booking_status = 'reserved' THEN 1 ELSE 0 END) as reserved_count,
    SUM(CASE WHEN r.booking_status = 'active' THEN 1 ELSE 0 END) as active_count
  FROM reservations r
  WHERE r.parking_spots_id = 0
  GROUP BY r.parking_section_id
) reservation_counts ON ps.parking_section_id = reservation_counts.parking_section_id
WHERE ps.vehicle_type = 'motorcycle'
ORDER BY ps.section_name;
