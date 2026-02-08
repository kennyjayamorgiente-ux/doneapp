/**
 * EXAMPLE: How to use Stale-While-Revalidate (SWR) caching in your React components
 * 
 * This demonstrates the new ApiService.requestWithRevalidate() pattern
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ApiService } from '../services/api';

// ============================================================================
// EXAMPLE 1: History Screen with SWR + Pull-to-Refresh
// ============================================================================
const HistoryScreenExample: React.FC = () => {
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load history with SWR caching
  const loadHistory = async (showLoader = false) => {
    try {
      if (showLoader) setIsInitialLoading(true);
      
      // This will:
      // 1. Return cached data instantly if available (even if stale)
      // 2. Fetch fresh data in background
      // 3. Call onRevalidate when fresh data arrives
      const response = await ApiService.getParkingHistory(
        1, 
        20, 
        undefined,
        (freshData) => {
          // This callback is called when fresh data arrives from background fetch
          console.log('📢 Fresh history data arrived!');
          if (freshData.success) {
            setHistoryData(freshData.data.sessions);
          }
        }
      );
      
      // Set initial data (could be from cache or fresh)
      if (response.success) {
        setHistoryData(response.data.sessions);
      }
    } catch (error) {
      console.error('Error loading history:', error);
    } finally {
      setIsInitialLoading(false);
    }
  };

  // Pull-to-refresh handler
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Force refresh bypasses cache completely
      const response = await ApiService.forceRefresh<any>(
        '/history/parking?page=1&limit=20'
      );
      if (response.success) {
        setHistoryData(response.data.sessions);
      }
    } catch (error) {
      console.error('Error refreshing:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Load on screen focus
  useFocusEffect(
    useCallback(() => {
      loadHistory(true);
    }, [])
  );

  return (
    <View style={{ flex: 1 }}>
      {isInitialLoading && historyData.length === 0 ? (
        <ActivityIndicator size="large" />
      ) : (
        <FlatList
          data={historyData}
          keyExtractor={(item) => item.reservation_id.toString()}
          renderItem={({ item }) => (
            <View style={{ padding: 16, borderBottomWidth: 1 }}>
              <Text>{item.location_name}</Text>
              <Text>{item.spot_number}</Text>
            </View>
          )}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
            />
          }
        />
      )}
    </View>
  );
};

// ============================================================================
// EXAMPLE 2: Home Screen with Vehicles + Frequent Spots (SWR)
// ============================================================================
const HomeScreenExample: React.FC = () => {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [frequentSpots, setFrequentSpots] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = async () => {
    try {
      setIsLoading(true);

      // Load vehicles with 2-minute stale time
      const vehiclesResponse = await ApiService.getVehicles((freshData) => {
        console.log('🚗 Fresh vehicles data arrived!');
        if (freshData.success) {
          setVehicles(freshData.data.vehicles);
        }
      });
      
      if (vehiclesResponse.success) {
        setVehicles(vehiclesResponse.data.vehicles);
      }

      // Load frequent spots with 2-minute stale time
      const spotsResponse = await ApiService.getFrequentSpots(5, (freshData) => {
        console.log('🔥 Fresh frequent spots arrived!');
        if (freshData.success) {
          setFrequentSpots(freshData.data.frequent_spots);
        }
      });
      
      if (spotsResponse.success) {
        setFrequentSpots(spotsResponse.data.frequent_spots);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: 'bold' }}>My Vehicles</Text>
      {vehicles.map((vehicle) => (
        <Text key={vehicle.id}>{vehicle.plate_number}</Text>
      ))}

      <Text style={{ fontSize: 20, fontWeight: 'bold', marginTop: 20 }}>
        Frequent Spots
      </Text>
      {frequentSpots.map((spot) => (
        <Text key={spot.parking_spot_id}>{spot.location_name}</Text>
      ))}
    </View>
  );
};

// ============================================================================
// EXAMPLE 3: Active Parking Screen with Real-time Updates
// ============================================================================
const ActiveParkingScreenExample: React.FC = () => {
  const [bookingData, setBookingData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadBooking = async () => {
    try {
      // Always revalidate bookings (0s stale time)
      const response = await ApiService.getMyBookings((freshData) => {
        console.log('📢 Fresh booking data arrived!');
        if (freshData.success && freshData.data.bookings.length > 0) {
          setBookingData(freshData.data.bookings[0]);
        }
      });

      if (response.success && response.data.bookings.length > 0) {
        setBookingData(response.data.bookings[0]);
      }
    } catch (error) {
      console.error('Error loading booking:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Poll every 10 seconds for updates
  useEffect(() => {
    loadBooking();
    const interval = setInterval(loadBooking, 10000);
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return <ActivityIndicator size="large" />;
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text>Booking Status: {bookingData?.bookingStatus}</Text>
      <Text>Spot: {bookingData?.parkingSlot?.spotNumber}</Text>
    </View>
  );
};

// ============================================================================
// EXAMPLE 4: After Mutation - Invalidate Cache
// ============================================================================
const BookingActionExample = () => {
  const handleEndSession = async (reservationId: number) => {
    try {
      // End session automatically invalidates related caches
      const response = await ApiService.endParkingSession(reservationId);
      
      if (response.success) {
        // Caches for /parking-areas/my-bookings, /history, and frequent spots
        // are automatically invalidated by the ApiService
        console.log('✅ Session ended, caches invalidated');
        
        // Next time you call getMyBookings(), getParkingHistory(), or getFrequentSpots(),
        // they will fetch fresh data instead of serving stale cache
      }
    } catch (error) {
      console.error('Error ending session:', error);
    }
  };

  const handleAddVehicle = async () => {
    try {
      const response = await ApiService.addVehicle({
        plateNumber: 'ABC123',
        vehicleType: 'car',
        brand: 'Toyota',
      });

      if (response.success) {
        // Vehicle cache is automatically invalidated
        console.log('✅ Vehicle added, cache invalidated');
        
        // Next getVehicles() call will fetch fresh data
      }
    } catch (error) {
      console.error('Error adding vehicle:', error);
    }
  };

  return null;
};

export {
  HistoryScreenExample,
  HomeScreenExample,
  ActiveParkingScreenExample,
  BookingActionExample,
};
