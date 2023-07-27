/* eslint-disable prefer-const */ // to satisfy AS compiler

// For each division by 10, add one to exponent to truncate one significant figure
import { BigDecimal, BigInt, Bytes, Address, log } from '@graphprotocol/graph-ts'
import {
  AccountXToken,
  Account,
  AccountXTokenTransaction,
  Comptroller,
  Market,
} from '../types/schema'
import { Comptroller as ComptrollerContract } from '../types/Comptroller/Comptroller'
import { updateMarket } from './markets'
import { xERC20 } from '../types/templates'
import { ERC20 } from '../types/templates/XErc20/ERC20'

const comptrollerAddress = Address.fromString(
  '0x4b50A1a9D00BF3C19083D8aCd4f2f28Cc5397a2a'.toLowerCase(),
)

export function exponentToBigDecimal(decimals: i32): BigDecimal {
  let bd = BigDecimal.fromString('1')
  for (let i = 0; i < decimals; i++) {
    bd = bd.times(BigDecimal.fromString('10'))
  }
  return bd
}

export let mantissaFactor = 18
export let xTokenDecimals = 8
export let mantissaFactorBD: BigDecimal = exponentToBigDecimal(18)
export let xTokenDecimalsBD: BigDecimal = exponentToBigDecimal(8)
export let zeroBD = BigDecimal.fromString('0')

export function createAccountXToken(
  xTokenStatsID: string,
  symbol: string,
  account: string,
  marketID: string,
): AccountXToken {
  let xTokenStats = new AccountXToken(xTokenStatsID)
  xTokenStats.symbol = symbol
  xTokenStats.market = marketID
  xTokenStats.account = account
  xTokenStats.accrualBlockNumber = BigInt.fromI32(0)
  // we need to set an initial real onchain value to this otherwise it will never
  // be accurate
  const xTokenContract = ERC20.bind(Address.fromString(marketID))
  xTokenStats.xTokenBalance = new BigDecimal(
    xTokenContract.balanceOf(Address.fromString(account)),
  )
  // log.debug('[createAccountXToken] xTokenBalance: {}, account: {}, xToken: {}', [xTokenStats.xTokenBalance.toString(), account, marketID]);

  xTokenStats.totalUnderlyingSupplied = zeroBD
  xTokenStats.totalUnderlyingRedeemed = zeroBD
  xTokenStats.accountBorrowIndex = zeroBD
  xTokenStats.totalUnderlyingBorrowed = zeroBD
  xTokenStats.totalUnderlyingRepaid = zeroBD
  xTokenStats.storedBorrowBalance = zeroBD
  xTokenStats.enteredMarket = false
  return xTokenStats
}

export function createAccount(accountID: string): Account {
  let account = new Account(accountID)
  account.countLiquidated = 0
  account.countLiquidator = 0
  account.hasBorrowed = false
  account.save()
  return account
}

export function updateCommonXTokenStats(
  marketID: string,
  marketSymbol: string,
  accountID: string,
  tx_hash: Bytes,
  timestamp: BigInt,
  blockNumber: BigInt,
  logIndex: BigInt,
): AccountXToken {
  let xTokenStatsID = marketID.concat('-').concat(accountID)
  let xTokenStats = AccountXToken.load(xTokenStatsID)
  if (xTokenStats == null) {
    xTokenStats = createAccountXToken(xTokenStatsID, marketSymbol, accountID, marketID)
  }
  getOrCreateAccountXTokenTransaction(
    xTokenStatsID,
    tx_hash,
    timestamp,
    blockNumber,
    logIndex,
  )
  xTokenStats.accrualBlockNumber = blockNumber
  return xTokenStats as AccountXToken
}

export function getOrCreateAccountXTokenTransaction(
  accountID: string,
  tx_hash: Bytes,
  timestamp: BigInt,
  block: BigInt,
  logIndex: BigInt,
): AccountXTokenTransaction {
  let id = accountID
    .concat('-')
    .concat(tx_hash.toHexString())
    .concat('-')
    .concat(logIndex.toString())
  let transaction = AccountXTokenTransaction.load(id)

  if (transaction == null) {
    transaction = new AccountXTokenTransaction(id)
    transaction.account = accountID
    transaction.tx_hash = tx_hash
    transaction.timestamp = timestamp
    transaction.block = block
    transaction.logIndex = logIndex
    transaction.save()
  }

  return transaction as AccountXTokenTransaction
}

export function ensureComptrollerSynced(
  blockNumber: i32,
  blockTimestamp: i32,
): Comptroller {
  let comptroller = Comptroller.load('1')
  if (comptroller) {
    return comptroller
  }

  comptroller = new Comptroller('1')
  // If we want to start indexing from a block behind markets creation, we might have to
  // wait a very long time to get a market related event being triggered, before which we
  // can't get any market info, so here we manually fill up market info
  const comptrollerContract = ComptrollerContract.bind(comptrollerAddress)

  // init
  comptroller.priceOracle = comptrollerContract.oracle()
  comptroller.closeFactor = comptrollerContract.closeFactorMantissa()
  comptroller.liquidationIncentive = comptrollerContract.liquidationIncentiveMantissa()
  comptroller.maxAssets = comptrollerContract.maxAssets()

  log.debug(
    '[ensureComptrollerSynced] comptroller info completed, oracle: {} closeFactor: {} liquidationIncentive: {} maxAssets: {}',
    [
      comptroller.priceOracle.toHexString(),
      comptroller.closeFactor.toString(),
      comptroller.liquidationIncentive.toString(),
      comptroller.maxAssets.toString(),
    ],
  )

  comptroller.save()

  const allMarkets = comptrollerContract.getAllMarkets()

  log.debug('[ensureComptrollerSynced] all markets length: {}', [
    allMarkets.length.toString(),
  ])

  for (let i = 0; i < allMarkets.length; i++) {
    updateMarket(allMarkets[i], blockNumber, blockTimestamp)
    xERC20.create(allMarkets[i])
  }

  return comptroller
}
