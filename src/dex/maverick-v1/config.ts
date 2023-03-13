import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const MAV_V1_BASE_GAS_COST = 5_574 + 2_258 + 4_472;
export const MAV_V1_TICK_GAS_COST = 18_960;
export const MAV_V1_KIND_GAS_COST = 9_890;

export const MaverickV1Config: DexConfigMap<DexParams> = {
  MaverickV1: {
    [Network.MAINNET]: {
      subgraphURL:
        'https://gateway.thegraph.com/api/4b42aaaee3e81a3f29390e9df7010cbc/subgraphs/id/9n4uEbt1XV6DnYH7AGHJ84Gh2fpu68iwxwBKnWqVMX9G',
      routerAddress: '0x4a585e0f7c18e2c414221d6402652d5e0990e5f8',
      poolInspectorAddress: '0xaA5BF61a664109e959D69C38734d4EA7dF74e456',
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.MAINNET]: {
    [SwapSide.SELL]: [{ name: 'Adapter04', index: 2 }],
    [SwapSide.BUY]: [{ name: 'BuyAdapter', index: 8 }],
  },
};
