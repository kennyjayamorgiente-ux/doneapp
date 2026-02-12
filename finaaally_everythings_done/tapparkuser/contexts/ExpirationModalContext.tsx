import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PENDING_EXPIRATION_STORAGE_KEY } from '../app/constants/storageKeys';

interface ExpirationDetails {
  reservationId?: number;
  spotNumber?: string;
  areaName?: string;
  userName?: string;
  billingBreakdown?: {
    waitTimeMinutes: number;
    parkingTimeMinutes: number;
    totalChargedHours: number;
    breakdown?: string;
  };
  timestamp: number;
}

interface ExpirationModalContextType {
  showExpirationModal: boolean;
  expirationDetails: ExpirationDetails | null;
  checkPendingReservationExpiration: () => Promise<void>;
  handleExpirationModalClose: () => void;
  showExpirationModalWithDetails: (details: ExpirationDetails) => void;
}

const EXPIRATION_MODAL_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export const ExpirationModalContext = createContext<ExpirationModalContextType | undefined>(undefined);

export const useExpirationModal = () => {
  const context = useContext(ExpirationModalContext);
  if (context === undefined) {
    throw new Error('useExpirationModal must be used within an ExpirationModalProvider');
  }
  return context;
};

interface ExpirationModalProviderProps {
  children: ReactNode;
}

export const ExpirationModalProvider: React.FC<ExpirationModalProviderProps> = ({ children }) => {
  const [showExpirationModal, setShowExpirationModal] = useState(false);
  const [expirationDetails, setExpirationDetails] = useState<ExpirationDetails | null>(null);

  const handleExpirationModalClose = useCallback(() => {
    setShowExpirationModal(false);
    setExpirationDetails(null);
  }, []);

  const checkPendingReservationExpiration = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(PENDING_EXPIRATION_STORAGE_KEY);
      if (!stored) {
        return;
      }

      await AsyncStorage.removeItem(PENDING_EXPIRATION_STORAGE_KEY);
      const parsed = JSON.parse(stored);

      const timestamp = parsed?.timestamp;
      if (!timestamp || Date.now() - timestamp > EXPIRATION_MODAL_MAX_AGE_MS) {
        return;
      }

      setExpirationDetails(parsed);
      setShowExpirationModal(true);
    } catch (error) {
      console.error('Error loading pending reservation expiration details:', error);
    }
  }, []);

  const showExpirationModalWithDetails = useCallback((details: ExpirationDetails) => {
    setExpirationDetails(details);
    setShowExpirationModal(true);
  }, []);

  const value: ExpirationModalContextType = {
    showExpirationModal,
    expirationDetails,
    checkPendingReservationExpiration,
    handleExpirationModalClose,
    showExpirationModalWithDetails,
  };

  return (
    <ExpirationModalContext.Provider value={value}>
      {children}
    </ExpirationModalContext.Provider>
  );
};
