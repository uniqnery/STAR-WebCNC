import { create } from 'zustand';
import { productionApi } from '../lib/api';
export const useFeatureStore = create<{ mesEnabled: boolean; loaded: boolean; load: () => Promise<void>; setMesEnabled: (enabled: boolean) => Promise<void> }>((set) => ({
  mesEnabled: false, loaded: false,
  load: async () => { const response = await productionApi.getFeatures(); if (response.success && response.data) set({ mesEnabled: response.data.mesEnabled, loaded: true }); },
  setMesEnabled: async enabled => { const response = await productionApi.setFeatures(enabled); if (!response.success) throw new Error(response.error?.message ?? 'MES 설정 저장 실패'); set({ mesEnabled: enabled, loaded: true }); },
}));
