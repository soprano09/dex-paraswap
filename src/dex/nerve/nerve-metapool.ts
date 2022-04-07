import _ from 'lodash';
import type { AbiItem } from 'web3-utils';
import { NerveEventPool } from './nerve-pool';
import {
  AdapterMappings,
  MetapoolState,
  NervePoolConfig,
  PoolOrMetapoolState,
  PoolState,
} from './types';
import { Address, Logger, Log } from '../../types';
import { IDexHelper } from '../../dex-helper';
import { Adapters, NerveConfig, threePoolName } from './config';
import { BlockHeader } from 'web3-eth';
import { DeepReadonly } from 'ts-essentials';
import { typeCastMetapoolState } from './utils';
const nerveMetapoolABIDefault = require('../../abi/nerve/nerve-metapool.json');

export class NerveEventMetapool extends NerveEventPool {
  basePool: NerveEventPool;

  metapoolAddressesSubscribed: Address[];

  constructor(
    protected parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    protected adapters = Adapters[network],
    protected poolName: string,
    public poolConfig: NervePoolConfig = NerveConfig[parentName][network]
      .poolConfigs[poolName],
    protected poolABI: AbiItem[] = nerveMetapoolABIDefault,
    BasePool: new (
      parentName: string,
      network: number,
      dexHelper: IDexHelper,
      logger: Logger,
      adapters: AdapterMappings,
      poolName: string,
    ) => NerveEventPool,
  ) {
    if (poolName === undefined)
      throw new Error(
        `Parameter poolName is required for NerveEventMetapool ${parentName}`,
      );

    super(
      parentName,
      network,
      dexHelper,
      logger,
      poolName,
      poolConfig,
      poolABI,
    );

    this.basePool = new BasePool(
      parentName,
      this.network,
      dexHelper,
      logger,
      adapters,
      threePoolName,
    );

    this.metapoolAddressesSubscribed = [this.address];

    this.addressesSubscribed = _.concat(
      this.metapoolAddressesSubscribed,
      this.basePool.addressesSubscribed,
    );

    // Add new event not supported by default pool
    this.handlers['TokenSwapUnderlying'] =
      this.handleTokenSwapUnderlying.bind(this);

    // Overload the basepool handlers to ignore the events generated by the metapool
    this.basePool.handlers['TokenSwap'] =
      this.handleBasePoolTokenSwap.bind(this);
    this.basePool.handlers['AddLiquidity'] =
      this.handleBasePoolAddLiquidity.bind(this);
    this.basePool.handlers['RemoveLiquidity'] =
      this.handleBasePoolRemoveLiquidity.bind(this);
    this.basePool.handlers['RemoveLiquidityOne'] =
      this.handleBasePoolRemoveLiquidityOne.bind(this);
    this.basePool.handlers['RemoveLiquidityImbalance'] =
      this.handleBasePoolRemoveLiquidityImbalance.bind(this);
  }

  processLog(
    state: DeepReadonly<MetapoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolOrMetapoolState> | null {
    // To handle logs of metapool and the base pool the following architecture is followed
    // If the logs are for base pool, look out if the msg.sender of the function that generated
    // the log is the metapool if so ignore the log. This is done by overloading the
    // event handler map in the base pool. If the msg.sender is not the meta pool handle it
    // normally and save the state in the metapoolState. If the log is for metapool then
    // just handle it directly, make sure to call the appropriate state changing function
    // of the base pool in the handler of the metapool.
    // Warning: Make sure to look out for operations in metapool which do read-write-read on
    // base pool. The sequence of state changes based on logs could be tricky, and also to
    // avoid double state change on the base pool.
    try {
      const _basepool =
        _.findIndex(
          this.basePool.addressesSubscribed,
          c => c.toLowerCase() === log.address.toLowerCase(),
        ) != -1
          ? this.basePool.processLog(state.basePool, log, blockHeader) ||
            state.basePool
          : state.basePool;

      const _state = typeCastMetapoolState(state, _basepool);

      // We assume that there is no common subscribed address between the basepool and metapool
      if (
        _.findIndex(
          this.metapoolAddressesSubscribed,
          c => c.toLowerCase() === log.address.toLowerCase(),
        ) !== -1
      ) {
        const event = this.logDecoder(log);
        if (event.name in this.handlers)
          return this.handlers[event.name](event, _state, log, blockHeader);
        return _state;
      }
      return _state;
    } catch (e) {
      this.logger.error(`Error: unexpected error handling log:`, e);
    }
    return state;
  }

  handleTokenSwapUnderlying(event: any, state: PoolState) {}

  handleBasePoolTokenSwap(
    event: any,
    state: PoolState,
    _2: Log,
    blockHeader: BlockHeader,
  ) {
    return this._handleHelperIfNotFromMetapool(
      event,
      state,
      this.basePool.handleTokenSwap.bind(this, event, state, _2, blockHeader),
    );
  }

  handleBasePoolAddLiquidity(event: any, state: PoolState) {
    return this._handleHelperIfNotFromMetapool(
      event,
      state,
      this.basePool.handleAddLiquidity.bind(this, event, state),
    );
  }

  handleBasePoolRemoveLiquidity(event: any, state: PoolState) {
    return this._handleHelperIfNotFromMetapool(
      event,
      state,
      this.basePool.handleRemoveLiquidity.bind(this, event, state),
    );
  }

  handleBasePoolRemoveLiquidityOne(event: any, state: PoolState) {
    return this._handleHelperIfNotFromMetapool(
      event,
      state,
      this.basePool.handleRemoveLiquidityOne.bind(this, event, state),
    );
  }

  handleBasePoolRemoveLiquidityImbalance(event: any, state: PoolState) {
    return this._handleHelperIfNotFromMetapool(
      event,
      state,
      this.basePool.handleRemoveLiquidityImbalance.bind(this, event, state),
    );
  }

  protected _isEventFromMetapool(event: any): boolean {
    return event.args.provider.toLowerCase() === this.address.toLowerCase();
  }

  protected _handleHelperIfNotFromMetapool(
    event: any,
    state: PoolState,
    handler: () => PoolState,
  ) {
    return this._isEventFromMetapool(event) ? state : handler();
  }
}
