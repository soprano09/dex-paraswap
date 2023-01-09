import { Logger, LogLevels, MultiCallOutput } from '../../types';
import { IDexHelper } from '../../dex-helper';
import {
  IStatefulRpcPoller,
  ObjWithUpdateInfo,
  PollingManagerControllersCb,
} from './types';
import { MultiCallParams } from '../multi-wrapper';
import { CACHE_PREFIX } from '../../constants';
import { uint256DecodeToNumber } from '../decoders';
import { assert } from 'ts-essentials';
import { getLogger } from '../log4js';
import { LogMessagesSuppressor, MessageInfo } from '../log-messages-suppressor';
import { Utils } from '../../utils';
import { getIdentifierKeyForRpcPoller } from './utils';

const StatefulRPCPollerMessages = {
  ERROR_FETCHING_STATE_FROM_CACHE: `Unexpected error while fetching state from Cache`,
  ERROR_FETCHING_STATE_FROM_RPC: `Unexpected error while fetching state from RPC`,
  ERROR_SAVING_LIQUIDITY_IN_CACHE: `Unexpected error while saving liquidity in Cache`,
  ERROR_SAVING_STATE_IN_CACHE: `Unexpected error while saving state in Cache`,

  FALLBACK_TO_RPC: `Failed to retrieve updated state from cache. Falling back to RPC`,

  LIQUIDITY_INFO_IS_OUTDATED:
    `Liquidity info in USD is outdated. Wil be updating ` +
    `every pool that is outdated to not degrade performance`,
} as const;

const DEFAULT_LIQUIDITY_UPDATE_PERIOD_MS = 2 * 60 * 1000;

export abstract class StatefulRpcPoller<State, M>
  implements IStatefulRpcPoller<State, M>
{
  static StatefulRPCPollerMessages: Record<
    keyof typeof StatefulRPCPollerMessages,
    MessageInfo<typeof StatefulRPCPollerMessages>
  > = {
    ERROR_FETCHING_STATE_FROM_CACHE: {
      key: 'ERROR_FETCHING_STATE_FROM_CACHE',
      message: StatefulRPCPollerMessages.ERROR_FETCHING_STATE_FROM_CACHE,
      logLevel: 'error',
    },
    ERROR_FETCHING_STATE_FROM_RPC: {
      key: 'ERROR_FETCHING_STATE_FROM_RPC',
      message: StatefulRPCPollerMessages.ERROR_FETCHING_STATE_FROM_RPC,
      logLevel: 'error',
    },
    ERROR_SAVING_LIQUIDITY_IN_CACHE: {
      key: 'ERROR_SAVING_LIQUIDITY_IN_CACHE',
      message: StatefulRPCPollerMessages.ERROR_SAVING_LIQUIDITY_IN_CACHE,
      logLevel: 'error',
    },
    ERROR_SAVING_STATE_IN_CACHE: {
      key: 'ERROR_SAVING_STATE_IN_CACHE',
      message: StatefulRPCPollerMessages.ERROR_SAVING_STATE_IN_CACHE,
      logLevel: 'error',
    },
    LIQUIDITY_INFO_IS_OUTDATED: {
      key: 'LIQUIDITY_INFO_IS_OUTDATED',
      message: StatefulRPCPollerMessages.LIQUIDITY_INFO_IS_OUTDATED,
      logLevel: 'error',
    },
    FALLBACK_TO_RPC: {
      key: 'FALLBACK_TO_RPC',
      message: StatefulRPCPollerMessages.FALLBACK_TO_RPC,
      logLevel: 'warn',
    },
  };

  // The current state and its block number
  // Derived classes should not set these directly, and instead use setState()
  protected _stateWithUpdateInfo?: ObjWithUpdateInfo<State>;

  // This values is used to determine if current pool will participate in update or not
  // We don't want to keep track of state od pools without liquidity
  protected _liquidityInUSDWithUpdateInfo: ObjWithUpdateInfo<number> = {
    value: 0,
    blockNumber: 0,
    lastUpdatedAtMs: 0,
  };

  readonly cacheStateKey: string;
  readonly cacheLiquidityMapKey: string;

  // Store here encoded calls for blockNumber, blockTimestamp etc.
  protected _cachedMultiCallData?: [
    MultiCallParams<number>,
    ...MultiCallParams<M>[],
  ];

  protected _getBlockNumberMultiCall: MultiCallParams<number>;

  readonly entityName: string;

  protected logMessagesSuppressor: LogMessagesSuppressor<
    typeof StatefulRPCPollerMessages
  >;

  protected _isStateToBeUpdated: boolean = true;

  readonly identifierKey: string;

  protected logger: Logger;

  constructor(
    readonly dexKey: string,
    poolIdentifier: string,
    protected dexHelper: IDexHelper,

    protected liquidityThresholdForUpdate: number,
    protected liquidityUpdateAllowedDelayMs: number,
    protected isLiquidityTracked: boolean,

    // Polling manager callbacks. They are useful when you want
    // to give some change information in reverse way.
    // For example, you changed liquidity state, notify manager to
    // not poll that particular pools
    protected managerCbControllers: PollingManagerControllersCb,

    // It is allowed block delay before refetching the state
    protected maxAllowedDelayedBlockRpcPolling: number = dexHelper.config.data
      .maxAllowedDelayedBlockRpcPolling,
    protected liquidityUpdatePeriodMs = DEFAULT_LIQUIDITY_UPDATE_PERIOD_MS,
  ) {
    // Don't make it too custom, like adding poolIdentifier. It will break log suppressor
    // If we are really need to do that, update log Suppressor to handle that case
    // The idea is to have one entity name per Dex level, not pool level
    this.entityName = `StatefulPoller-${this.dexKey}-${this.dexHelper.config.data.network}`;

    // I made it a little bit different from poolIdentifier, because usually
    // pool identifier doesn't contain network information and it may occasionally
    // collide across chains, though that scenario is very unlikely to happen
    this.identifierKey = getIdentifierKeyForRpcPoller(
      poolIdentifier,
      this.network,
    );

    this.cacheLiquidityMapKey =
      `${CACHE_PREFIX}_${this.network}_${this.dexKey}_liquidity_usd`.toLowerCase();
    this.cacheStateKey =
      `${CACHE_PREFIX}_${this.network}_${this.dexKey}_states`.toLowerCase();
    this.logger = getLogger(`${this.dexKey}-${this.entityName}`);

    assert(
      this.maxAllowedDelayedBlockRpcPolling <=
        dexHelper.config.data.maxAllowedDelayedBlockRpcPolling,
      `You can not exceed global maxAllowedDelayedBlockRpcPolling=` +
        `${dexHelper.config.data.maxAllowedDelayedBlockRpcPolling}. ` +
        `Received ${this.maxAllowedDelayedBlockRpcPolling}`,
    );

    this._getBlockNumberMultiCall = {
      target: this.dexHelper.multiContract.options.address,
      callData: this.dexHelper.multiContract.methods
        .getBlockNumber()
        .encodeABI(),
      decodeFunction: uint256DecodeToNumber,
    };

    this.logMessagesSuppressor = LogMessagesSuppressor.getLogSuppressorInstance<
      typeof StatefulRPCPollerMessages
    >(
      this.entityName,
      StatefulRpcPoller.StatefulRPCPollerMessages,
      this.logger,
    );
  }

  get network() {
    return this.dexHelper.config.data.network;
  }

  get isMaster() {
    return !this.dexHelper.config.isSlave;
  }

  protected _isStateOutdated(
    checkForBlockNumber: number,
    stateValidBlockNumber: number,
    stateValidityBlockNumDelay: number,
  ): boolean {
    return (
      checkForBlockNumber - stateValidBlockNumber > stateValidityBlockNumDelay
    );
  }

  protected _isInMemoryStateOutdated(blockNumber: number): boolean {
    return this._isStateOutdated(
      blockNumber,
      this._stateWithUpdateInfo?.blockNumber || 0,
      this.maxAllowedDelayedBlockRpcPolling,
    );
  }

  async getState(
    blockNumber: number,
  ): Promise<ObjWithUpdateInfo<State> | null> {
    // Try to get with least effort from local memory
    const localState = this._stateWithUpdateInfo;
    if (localState !== undefined) {
      if (!this._isInMemoryStateOutdated(blockNumber)) {
        return localState;
      } else {
        this.immediateLogMessage(
          `State is outdated. Valid for number ${
            localState.blockNumber
          }, but requested for ${blockNumber}. Diff ${
            blockNumber - localState.blockNumber
          } blocks`,
          'trace',
        );
      }
    } else {
      this.immediateLogMessage(`State is not initialized in memory`, 'error');
    }

    // If we failed to get from memory. Try to fetch state from cache
    try {
    } catch (e) {
      this.logMessageWithSuppression(`ERROR_FETCHING_STATE_FROM_CACHE`, e);
    }

    this.logMessageWithSuppression('FALLBACK_TO_RPC');

    // As the last step. If we failed everything above, try to fetch from RPC
    try {
    } catch (e) {
      this.logMessageWithSuppression('ERROR_FETCHING_STATE_FROM_RPC', e);
    }

    // If nothing works, then we can not do anything here and skip this pool
    return null;
  }

  protected logMessageWithSuppression(
    msgKey: keyof typeof StatefulRPCPollerMessages,
    ...args: unknown[]
  ) {
    this.logMessagesSuppressor.logMessage(msgKey, this.identifierKey, ...args);
  }

  protected immediateLogMessage(
    message: string,
    level: LogLevels,
    ...args: unknown[]
  ) {
    this.logger[level](`${this.entityName}: ${message}`, ...args);
  }

  get isStateToBeUpdated(): boolean {
    return this._isStateToBeUpdated;
  }

  set isStateToBeUpdated(value: boolean) {
    // If we change state update status, we always keep relevant info in manager
    value
      ? this.managerCbControllers.enableStateTracking(this.identifierKey)
      : this.managerCbControllers.disableStateTracking(this.identifierKey);

    this._isStateToBeUpdated = value;
  }

  protected abstract _getFetchStateMultiCalls(): MultiCallParams<M>[];

  getFetchStateWithBlockInfoMultiCalls(): [
    MultiCallParams<number>,
    ...MultiCallParams<M>[],
  ] {
    if (this._cachedMultiCallData === undefined) {
      const stateMultiCalls = this._getFetchStateMultiCalls();
      this._cachedMultiCallData = [
        this._getBlockNumberMultiCall,
        ...stateMultiCalls,
      ];
    }

    return this._cachedMultiCallData;
  }

  protected abstract _parseStateFromMultiResults(multiOutputs: M[]): State;

  parseStateFromMultiResultsWithBlockInfo(
    multiOutputs: [number, ...M[]],
    lastUpdatedAtMs: number,
  ): ObjWithUpdateInfo<State> {
    // By abstract I mean for abstract method which must be implemented
    const [blockNumber, ...outputsForAbstract] = multiOutputs;

    return {
      value: this._parseStateFromMultiResults(outputsForAbstract),
      blockNumber,
      lastUpdatedAtMs,
    };
  }

  async fetchLatestStateFromRpc(): Promise<ObjWithUpdateInfo<State> | null> {
    const multiCalls = this.getFetchStateWithBlockInfoMultiCalls();
    try {
      const lastUpdatedAtMs = Date.now();
      const aggregatedResults = (await this.dexHelper.multiWrapper.aggregate<
        number | M
      >(multiCalls as MultiCallParams<M | number>[])) as [number, ...M[]];

      return this.parseStateFromMultiResultsWithBlockInfo(
        aggregatedResults,
        lastUpdatedAtMs,
      );
    } catch (e) {
      this.logMessageWithSuppression('ERROR_FETCHING_STATE_FROM_RPC', e);
    }

    return null;
  }

  async setState(
    state: State,
    blockNumber: number,
    lastUpdatedAtMs: number,
  ): Promise<void> {
    if (this._stateWithUpdateInfo === undefined) {
      this._stateWithUpdateInfo = {
        value: state,
        blockNumber,
        lastUpdatedAtMs,
      };
    } else {
      this._stateWithUpdateInfo.value = state;
      this._stateWithUpdateInfo.blockNumber = blockNumber;
      this._stateWithUpdateInfo.lastUpdatedAtMs = lastUpdatedAtMs;
    }

    // Master version must keep cache up to date
    if (this.isMaster) {
      await this.saveStateInCache();
    }
  }

  async saveStateInCache(): Promise<boolean> {
    try {
      await this.dexHelper.cache.hset(
        this.cacheStateKey,
        this.identifierKey,
        Utils.Serialize(this._stateWithUpdateInfo),
      );
      return true;
    } catch (e) {
      this.logMessageWithSuppression('ERROR_SAVING_STATE_IN_CACHE', e);
    }
    return false;
  }

  async saveLiquidityInCache(): Promise<boolean> {
    try {
      await this.dexHelper.cache.setex(
        this.dexKey,
        this.network,
        this.cacheLiquidityMapKey,
        this._getExpiryTimeForCachedLiquidity(),
        JSON.stringify(this._liquidityInUSDWithUpdateInfo),
      );
      return true;
    } catch (e) {
      this.logMessageWithSuppression('ERROR_SAVING_LIQUIDITY_IN_CACHE', e);
    }
    return false;
  }

  async fetchStateFromCache(): Promise<ObjWithUpdateInfo<State> | null> {
    const resultUnparsed = await this.dexHelper.cache.hget(
      this.cacheStateKey,
      this.identifierKey,
    );

    if (resultUnparsed !== null) {
      return Utils.Parse(resultUnparsed) as ObjWithUpdateInfo<State>;
    }

    return null;
  }

  async fetchLiquidityFromCache(): Promise<ObjWithUpdateInfo<number> | null> {
    const resultUnparsed = await this.dexHelper.cache.get(
      this.dexKey,
      this.network,
      this.cacheStateKey,
    );

    if (resultUnparsed !== null) {
      return Utils.Parse(resultUnparsed) as ObjWithUpdateInfo<number>;
    }

    return null;
  }

  async setLiquidity(
    newLiquidityInUSD: number,
    lastUpdatedAtMs: number,
    blockNumber?: number,
  ): Promise<void> {
    this._liquidityInUSDWithUpdateInfo.value = newLiquidityInUSD;
    this._liquidityInUSDWithUpdateInfo.lastUpdatedAtMs = lastUpdatedAtMs;
    this._liquidityInUSDWithUpdateInfo.blockNumber = blockNumber || 0;

    this._adjustIsStateToBeUpdated();

    if (this.isMaster) {
      await this.saveLiquidityInCache();
    }
  }

  protected _adjustIsStateToBeUpdated() {
    if (this.isLiquidityTracked) {
      if (
        Date.now() - this._liquidityInUSDWithUpdateInfo.lastUpdatedAtMs >
        this.liquidityUpdateAllowedDelayMs
      ) {
        this.logMessageWithSuppression(
          'LIQUIDITY_INFO_IS_OUTDATED',
          `Last updated at ${this._liquidityInUSDWithUpdateInfo.lastUpdatedAtMs}`,
        );
        this.isStateToBeUpdated = true;
      } else {
        this.isStateToBeUpdated =
          this._liquidityInUSDWithUpdateInfo.value >=
          this.liquidityThresholdForUpdate;
      }
    }
  }
  protected _getExpiryTimeForCachedLiquidity() {
    // Give it 10 minutes margin to recover
    return Math.floor(this.liquidityUpdatePeriodMs / 1000) + 10 * 60 * 1000;
  }
}
