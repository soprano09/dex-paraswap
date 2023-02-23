import { Network, SwapSide } from '../constants';
import { Address } from '../types';
import { IDexTxBuilder } from './idex';
import Web3 from 'web3';
import { UniswapV3, UniswapV3Param } from './uniswap-v3';
import { pack } from '@ethersproject/solidity';
import { IDexHelper } from '../dex-helper';

const ZYBERSWAP_V3_ROUTER_ADDRESS: { [network: number]: Address } = {
  [Network.ARBITRUM]: '0xfa58b8024b49836772180f2df902f231ba712f72',
};

export type ZyberswapV3Data = {
  // ExactInputSingleParams
  deadline?: number;
  path: {
    tokenIn: Address;
    tokenOut: Address;
  }[];
};

export class ZyberswapV3
  extends UniswapV3
  implements IDexTxBuilder<ZyberswapV3Data, UniswapV3Param>
{
  static dexKeys = ['zyberswapv3'];

  constructor(dexHelper: IDexHelper) {
    super(
      dexHelper,
      'zyberswapv3',
      ZYBERSWAP_V3_ROUTER_ADDRESS[dexHelper.config.data.network],
    );
  }

  // override parent as ZyberswapV3 handles fees dynamically.
  protected encodePath(
    path: {
      tokenIn: Address;
      tokenOut: Address;
      fee: number;
    }[],
    side: SwapSide,
  ): string {
    if (path.length === 0) {
      return '0x';
    }

    const { _path, types } = path.reduce(
      (
        { _path, types }: { _path: string[]; types: string[] },
        curr,
        index,
      ): { _path: string[]; types: string[] } => {
        if (index === 0) {
          return {
            types: ['address', 'address'],
            _path: [curr.tokenIn, curr.tokenOut],
          };
        } else {
          return {
            types: [...types, 'address'],
            _path: [..._path, curr.tokenOut],
          };
        }
      },
      { _path: [], types: [] },
    );

    return side === SwapSide.BUY
      ? pack(types.reverse(), _path.reverse())
      : pack(types, _path);
  }
}
