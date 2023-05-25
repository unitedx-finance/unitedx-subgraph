/* eslint-disable prefer-const */ // to satisfy AS compiler

import {
  MarketEntered,
  MarketExited,
  NewCloseFactor,
  NewCollateralFactor,
  NewLiquidationIncentive,
  NewPriceOracle,
  MarketListed,
} from '../types/Comptroller/Comptroller'
import { log, Address } from '@graphprotocol/graph-ts'

import { xERC20 } from '../types/templates'
import { Market, Comptroller, Account } from '../types/schema'
import {
  mantissaFactorBD,
  updateCommonXTokenStats,
  createAccount,
  ensureComptrollerSynced,
} from './helpers'
import { createMarket } from './markets'

export function handleMarketListed(event: MarketListed): void {
  log.debug('BEFORE: {}', [event.params.cToken.toHexString()])
  // Dynamically index all new listed tokens
  xERC20.create(event.params.cToken)
  log.debug('AFTER: {}', [event.params.cToken.toHexString()])
  // XToken.create(event.params.cToken)
  // Create the market for this token, since it's now been listed.
  let market = createMarket(event.params.cToken.toHexString())
  market.save()
}

export function handleMarketEntered(event: MarketEntered): void {
  let market = Market.load(event.params.cToken.toHexString())
  // Null check needed to avoid crashing on a new market added. Ideally when dynamic data
  // sources can source from the contract creation block and not the time the
  // comptroller adds the market, we can avoid this altogether
  if (!market) {
    log.debug('[handleMarketEntered] market null: {}', [
      event.params.cToken.toHexString(),
    ])
    ensureComptrollerSynced(event.block.number.toI32(), event.block.timestamp.toI32())
    market = Market.load(event.params.cToken.toHexString())
  }

  if (!market) {
    log.debug('[handleMarketEntered] market still null, return...', [])
    return
  }

  let accountID = event.params.account.toHex()
  let account = Account.load(accountID)
  if (account == null) {
    createAccount(accountID)
  }

  let cTokenStats = updateCommonXTokenStats(
    market.id,
    market.symbol,
    accountID,
    event.transaction.hash,
    event.block.timestamp,
    event.block.number,
    event.logIndex,
  )
  cTokenStats.enteredMarket = true
  cTokenStats.save()
}

export function handleMarketExited(event: MarketExited): void {
  let market = Market.load(event.params.cToken.toHexString())
  // Null check needed to avoid crashing on a new market added. Ideally when dynamic data
  // sources can source from the contract creation block and not the time the
  // comptroller adds the market, we can avoid this altogether
  if (!market) {
    log.debug('[handleMarketExited] market null: {}', [event.params.cToken.toHexString()])
    ensureComptrollerSynced(event.block.number.toI32(), event.block.timestamp.toI32())
    market = Market.load(event.params.cToken.toHexString())
  }

  if (!market) {
    log.debug('[handleMarketExited] market still null, return...', [])
    return
  }

  let accountID = event.params.account.toHex()
  let account = Account.load(accountID)
  if (account == null) {
    createAccount(accountID)
  }

  let cTokenStats = updateCommonXTokenStats(
    market.id,
    market.symbol,
    accountID,
    event.transaction.hash,
    event.block.timestamp,
    event.block.number,
    event.logIndex,
  )
  cTokenStats.enteredMarket = false
  cTokenStats.save()
}

export function handleNewCloseFactor(event: NewCloseFactor): void {
  let comptroller = Comptroller.load('1')
  if (comptroller == null) {
    comptroller = new Comptroller('1')
  }
  comptroller.closeFactor = event.params.newCloseFactorMantissa
  comptroller.save()
}

export function handleNewCollateralFactor(event: NewCollateralFactor): void {
  let market = Market.load(event.params.cToken.toHexString())
  // Null check needed to avoid crashing on a new market added. Ideally when dynamic data
  // sources can source from the contract creation block and not the time the
  // comptroller adds the market, we can avoid this altogether
  if (market != null) {
    market.collateralFactor = event.params.newCollateralFactorMantissa
      .toBigDecimal()
      .div(mantissaFactorBD)
    market.save()
  }
}

// This should be the first event acccording to bscscan but it isn't.... price oracle is. weird
export function handleNewLiquidationIncentive(event: NewLiquidationIncentive): void {
  let comptroller = Comptroller.load('1')
  if (comptroller == null) {
    comptroller = new Comptroller('1')
  }
  comptroller.liquidationIncentive = event.params.newLiquidationIncentiveMantissa
  comptroller.save()
}

export function handleNewPriceOracle(event: NewPriceOracle): void {
  let comptroller = Comptroller.load('1')
  // This is the first event used in this mapping, so we use it to create the entity
  if (comptroller == null) {
    comptroller = new Comptroller('1')
  }
  comptroller.priceOracle = event.params.newPriceOracle
  comptroller.save()
}
