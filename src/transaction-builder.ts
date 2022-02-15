import { OptimalRate, Address, Adapters } from './types';
import { ETHER_ADDRESS, SwapSide } from './constants';
import { RouterService } from './router';
import { DexAdapterService } from './dex';
import { IDexHelper } from './dex-helper/idex-helper';

export class TransactionBuilder {
  routerService: RouterService;
  dexAdapterService: DexAdapterService;

  constructor(
    protected network: number,
    protected dexHelper: IDexHelper,
    adapters: Adapters = {},
    buyAdapters: Adapters = {},
  ) {
    this.dexAdapterService = new DexAdapterService(dexHelper, network);
    this.routerService = new RouterService(
      this.dexAdapterService,
      adapters,
      buyAdapters,
    );
  }

  public async build({
    priceRoute,
    minMaxAmount,
    userAddress,
    partnerAddress,
    partnerFeePercent,
    gasPrice,
    maxFeePerGas,
    maxPriorityFeePerGas,
    permit,
    deadline,
    uuid,
    beneficiary,
    onlyParams = false,
  }: {
    priceRoute: OptimalRate;
    minMaxAmount: string;
    userAddress: Address;
    partnerAddress: Address;
    partnerFeePercent: string;
    gasPrice?: string; // // @TODO: improve types? so that either gasPrice or ALL of max.*FeePerGas MUST be returned?
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    permit?: string;
    deadline: string;
    uuid: string;
    beneficiary?: Address;
    onlyParams?: boolean;
  }) {
    const _beneficiary = beneficiary || userAddress;
    const { encoder, params, networkFee } = await this.routerService
      .getRouterByContractMethod(priceRoute.contractMethod)
      .build(
        priceRoute,
        minMaxAmount,
        userAddress,
        partnerAddress,
        partnerFeePercent,
        _beneficiary,
        permit || '0x',
        deadline,
        uuid,
      );

    if (onlyParams) return params;

    const value = (
      priceRoute.srcToken.toLowerCase() === ETHER_ADDRESS.toLowerCase()
        ? BigInt(
            priceRoute.side === SwapSide.SELL
              ? priceRoute.srcAmount
              : minMaxAmount,
          ) + BigInt(networkFee)
        : BigInt(networkFee)
    ).toString();

    return {
      from: userAddress,
      to: priceRoute.contractAddress,
      value,
      data: encoder.apply(null, params),
      gasPrice,
      maxFeePerGas,
      maxPriorityFeePerGas,
    };
  }
}
