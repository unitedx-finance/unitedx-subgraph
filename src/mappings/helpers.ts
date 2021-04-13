/* eslint-disable prefer-const */ // to satisfy AS compiler

// For each division by 10, add one to exponent to truncate one significant figure
import { BigDecimal, BigInt, Bytes, Address } from '@graphprotocol/graph-ts'
import { AccountVToken, Account, AccountVTokenTransaction } from '../types/schema'

export function exponentToBigDecimal(decimals: i32): BigDecimal {
  let bd = BigDecimal.fromString('1')
  for (let i = 0; i < decimals; i++) {
    bd = bd.times(BigDecimal.fromString('10'))
  }
  return bd
}

export let mantissaFactor = 18
export let vTokenDecimals = 8
export let mantissaFactorBD: BigDecimal = exponentToBigDecimal(18)
export let vTokenDecimalsBD: BigDecimal = exponentToBigDecimal(8)
export let zeroBD = BigDecimal.fromString('0')

export function createAccountVToken(
  vTokenStatsID: string,
  symbol: string,
  account: string,
  marketID: string,
): AccountVToken {
  let vTokenStats = new AccountVToken(vTokenStatsID)
  vTokenStats.symbol = symbol
  vTokenStats.market = marketID
  vTokenStats.account = account
  vTokenStats.accrualBlockNumber = BigInt.fromI32(0)
  vTokenStats.vTokenBalance = zeroBD
  vTokenStats.totalUnderlyingSupplied = zeroBD
  vTokenStats.totalUnderlyingRedeemed = zeroBD
  vTokenStats.accountBorrowIndex = zeroBD
  vTokenStats.totalUnderlyingBorrowed = zeroBD
  vTokenStats.totalUnderlyingRepaid = zeroBD
  vTokenStats.storedBorrowBalance = zeroBD
  vTokenStats.enteredMarket = false
  return vTokenStats
}

export function createAccount(accountID: string): Account {
  let account = new Account(accountID)
  account.countLiquidated = 0
  account.countLiquidator = 0
  account.hasBorrowed = false
  account.save()
  return account
}

export function updateCommonVTokenStats(
  marketID: string,
  marketSymbol: string,
  accountID: string,
  tx_hash: Bytes,
  timestamp: BigInt,
  blockNumber: BigInt,
  logIndex: BigInt,
): AccountVToken {
  let vTokenStatsID = marketID.concat('-').concat(accountID)
  let vTokenStats = AccountVToken.load(vTokenStatsID)
  if (vTokenStats == null) {
    vTokenStats = createAccountVToken(vTokenStatsID, marketSymbol, accountID, marketID)
  }
  getOrCreateAccountVTokenTransaction(
    vTokenStatsID,
    tx_hash,
    timestamp,
    blockNumber,
    logIndex,
  )
  vTokenStats.accrualBlockNumber = blockNumber
  return vTokenStats as AccountVToken
}

export function getOrCreateAccountVTokenTransaction(
  accountID: string,
  tx_hash: Bytes,
  timestamp: BigInt,
  block: BigInt,
  logIndex: BigInt,
): AccountVTokenTransaction {
  let id = accountID
    .concat('-')
    .concat(tx_hash.toHexString())
    .concat('-')
    .concat(logIndex.toString())
  let transaction = AccountVTokenTransaction.load(id)

  if (transaction == null) {
    transaction = new AccountVTokenTransaction(id)
    transaction.account = accountID
    transaction.tx_hash = tx_hash
    transaction.timestamp = timestamp
    transaction.block = block
    transaction.logIndex = logIndex
    transaction.save()
  }

  return transaction as AccountVTokenTransaction
}
