/* eslint-disable prefer-const */ // to satisfy AS compiler
import { Address, log } from '@graphprotocol/graph-ts'
import {
  Mint,
  Redeem,
  Borrow,
  RepayBorrow,
  LiquidateBorrow,
  Transfer,
  AccrueInterest,
  NewReserveFactor,
  NewMarketInterestRateModel,
  XToken,
} from '../types/templates/XErc20/XToken'
import {
  Market,
  Account,
  MintEvent,
  RedeemEvent,
  LiquidationEvent,
  TransferEvent,
  BorrowEvent,
  RepayEvent,
  Comptroller,
} from '../types/schema'
import { PriceOracle } from '../types/templates/XErc20/PriceOracle'
import { createMarket, updateMarket } from './markets'
import {
  createAccount,
  updateCommonXTokenStats,
  exponentToBigDecimal,
  xTokenDecimalsBD,
  xTokenDecimals,
  zeroBD,
  mantissaFactor,
  mantissaFactorBD,
} from './helpers'

let xMADAAddress = '0x54115dbEc05C371303243f42a97052BB3A04d49c'.toLowerCase()

/* Account supplies assets into market and receives xTokens in exchange
 *
 * event.mintAmount is the underlying asset
 * event.mintTokens is the amount of xTokens minted
 * event.minter is the account
 *
 * Notes
 *    Transfer event will always get emitted with this
 *    Mints originate from the xToken address, not 0x000000, which is typical of ERC-20s
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 *    No need to updateCommonXTokenStats, handleTransfer() will
 *    No need to update xTokenBalance, handleTransfer() will
 */
export function handleMint(event: Mint): void {
  let market = Market.load(event.address.toHexString())
  if (!market) {
    market = createMarket(event.address.toHexString())
  }
  let mintID = event.transaction.hash
    .toHexString()
    .concat('-')
    .concat(event.transactionLogIndex.toString())

  let xTokenAmount = event.params.mintTokens
    .toBigDecimal()
    .div(xTokenDecimalsBD)
    .truncate(xTokenDecimals)
  let underlyingAmount = event.params.mintAmount
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)

  let mint = new MintEvent(mintID)
  mint.amount = xTokenAmount
  mint.to = event.params.minter
  mint.from = event.address
  mint.blockNumber = event.block.number.toI32()
  mint.blockTime = event.block.timestamp.toI32()
  mint.xTokenSymbol = market.symbol
  mint.underlyingAmount = underlyingAmount

  const xToken = XToken.bind(Address.fromBytes(event.address))
  let supplyRatePerBlock = xToken.try_supplyRatePerBlock()
  mint.supplyRatePerBlock = supplyRatePerBlock.reverted
    ? zeroBD
    : supplyRatePerBlock.value.toBigDecimal()

  let borrowRatePerBlock = xToken.try_borrowRatePerBlock()
  mint.borrowRatePerBlock = borrowRatePerBlock.reverted
    ? zeroBD
    : borrowRatePerBlock.value.toBigDecimal()

  let exchangeRateStored = xToken.try_exchangeRateStored()
  mint.exchangeRate = exchangeRateStored.reverted
    ? zeroBD
    : exchangeRateStored.value.toBigDecimal()

  let totalSupply = xToken.try_totalSupply()
  mint.totalSupply = totalSupply.reverted
    ? zeroBD
    : totalSupply.value.toBigDecimal().div(exponentToBigDecimal(xToken.decimals()))

  let totalBorrow = xToken.try_totalBorrows()
  mint.totalBorrow = totalBorrow.reverted
    ? zeroBD
    : totalBorrow.value
        .toBigDecimal()
        .div(exponentToBigDecimal(market.underlyingDecimals))
        .truncate(market.underlyingDecimals)

  let comptroller = Comptroller.load('1')
  if (!comptroller) {
    comptroller = new Comptroller('1')
  }

  let oracleAddress = Address.fromBytes(comptroller.priceOracle)
  let oracle = PriceOracle.bind(oracleAddress)

  if (market.id == xMADAAddress) {
    const price = oracle.try_getUnderlyingPrice(Address.fromString(market.id))
    mint.priceUSD = price.reverted
      ? zeroBD
      : price.value.toBigDecimal().div(mantissaFactorBD)
  } else {
    const price = oracle.try_getUnderlyingPrice(Address.fromString(market.id))
    let mantissaDecimalFactor = 18 - market.underlyingDecimals + 18
    let bdFactor = exponentToBigDecimal(mantissaDecimalFactor)

    mint.priceUSD = price.reverted ? zeroBD : price.value.toBigDecimal().div(bdFactor)
  }

  mint.save()
}

/*  Account supplies xTokens into market and receives underlying asset in exchange
 *
 *  event.redeemAmount is the underlying asset
 *  event.redeemTokens is the xTokens
 *  event.redeemer is the account
 *
 *  Notes
 *    Transfer event will always get emitted with this
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 *    No need to updateCommonXTokenStats, handleTransfer() will
 *    No need to update xTokenBalance, handleTransfer() will
 */
export function handleRedeem(event: Redeem): void {
  let market = Market.load(event.address.toHexString())
  if (!market) {
    market = createMarket(event.address.toHexString())
  }
  let redeemID = event.transaction.hash
    .toHexString()
    .concat('-')
    .concat(event.transactionLogIndex.toString())

  let xTokenAmount = event.params.redeemTokens
    .toBigDecimal()
    .div(xTokenDecimalsBD)
    .truncate(xTokenDecimals)
  let underlyingAmount = event.params.redeemAmount
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)

  let redeem = new RedeemEvent(redeemID)
  redeem.amount = xTokenAmount
  redeem.to = event.address
  redeem.from = event.params.redeemer
  redeem.blockNumber = event.block.number.toI32()
  redeem.blockTime = event.block.timestamp.toI32()
  redeem.xTokenSymbol = market.symbol
  redeem.underlyingAmount = underlyingAmount
  redeem.save()
}

/* Borrow assets from the protocol. All values either BNB or BEP20
 *
 * event.params.totalBorrows = of the whole market (not used right now)
 * event.params.accountBorrows = total of the account
 * event.params.borrowAmount = that was added in this event
 * event.params.borrower = the account
 * Notes
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 */
export function handleBorrow(event: Borrow): void {
  let market = Market.load(event.address.toHexString())
  if (!market) {
    market = createMarket(event.address.toHexString())
  }
  let accountID = event.params.borrower.toHex()
  let account = Account.load(accountID)
  if (account == null) {
    account = createAccount(accountID)
  }
  account.hasBorrowed = true
  account.save()

  // Update xTokenStats common for all events, and return the stats to update unique
  // values for each event
  let xTokenStats = updateCommonXTokenStats(
    market.id,
    market.symbol,
    accountID,
    event.transaction.hash,
    event.block.timestamp,
    event.block.number,
    event.logIndex,
  )

  let borrowAmountBD = event.params.borrowAmount
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))

  let previousBorrow = xTokenStats.storedBorrowBalance

  xTokenStats.storedBorrowBalance = event.params.accountBorrows
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)

  xTokenStats.accountBorrowIndex = market.borrowIndex
  xTokenStats.totalUnderlyingBorrowed = xTokenStats.totalUnderlyingBorrowed.plus(
    borrowAmountBD,
  )
  xTokenStats.save()

  let borrowID = event.transaction.hash
    .toHexString()
    .concat('-')
    .concat(event.transactionLogIndex.toString())

  let borrowAmount = event.params.borrowAmount
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)

  let accountBorrows = event.params.accountBorrows
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)

  let borrow = new BorrowEvent(borrowID)
  borrow.amount = borrowAmount
  borrow.accountBorrows = accountBorrows
  borrow.borrower = event.params.borrower
  borrow.blockNumber = event.block.number.toI32()
  borrow.blockTime = event.block.timestamp.toI32()
  borrow.underlyingSymbol = market.underlyingSymbol
  borrow.save()
}

/* Repay some amount borrowed. Anyone can repay anyones balance
 *
 * event.params.totalBorrows = of the whole market (not used right now)
 * event.params.accountBorrows = total of the account (not used right now)
 * event.params.repayAmount = that was added in this event
 * event.params.borrower = the borrower
 * event.params.payer = the payer
 *
 * Notes
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this
 *    Once a account totally repays a borrow, it still has its account interest index set to the
 *    markets value. We keep this, even though you might think it would reset to 0 upon full
 *    repay.
 */
export function handleRepayBorrow(event: RepayBorrow): void {
  let market = Market.load(event.address.toHexString())
  if (!market) {
    market = createMarket(event.address.toHexString())
  }
  let accountID = event.params.borrower.toHex()
  let account = Account.load(accountID)
  if (account == null) {
    createAccount(accountID)
  }

  // Update xTokenStats common for all events, and return the stats to update unique
  // values for each event
  let xTokenStats = updateCommonXTokenStats(
    market.id,
    market.symbol,
    accountID,
    event.transaction.hash,
    event.block.timestamp,
    event.block.number,
    event.logIndex,
  )

  let repayAmountBD = event.params.repayAmount
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))

  xTokenStats.storedBorrowBalance = event.params.accountBorrows
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)

  xTokenStats.accountBorrowIndex = market.borrowIndex
  xTokenStats.totalUnderlyingRepaid = xTokenStats.totalUnderlyingRepaid.plus(
    repayAmountBD,
  )
  xTokenStats.save()

  let repayID = event.transaction.hash
    .toHexString()
    .concat('-')
    .concat(event.transactionLogIndex.toString())

  let repayAmount = event.params.repayAmount
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)

  let accountBorrows = event.params.accountBorrows
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals)

  let repay = new RepayEvent(repayID)
  repay.amount = repayAmount
  repay.accountBorrows = accountBorrows
  repay.borrower = event.params.borrower
  repay.blockNumber = event.block.number.toI32()
  repay.blockTime = event.block.timestamp.toI32()
  repay.underlyingSymbol = market.underlyingSymbol
  repay.payer = event.params.payer
  repay.save()
}

/*
 * Liquidate an account who has fell below the collateral factor.
 *
 * event.params.borrower - the borrower who is getting liquidated of their xTokens
 * event.params.xTokenCollateral - the market ADDRESS of the vtoken being liquidated
 * event.params.liquidator - the liquidator
 * event.params.repayAmount - the amount of underlying to be repaid
 * event.params.seizeTokens - xTokens seized (transfer event should handle this)
 *
 * Notes
 *    No need to updateMarket(), handleAccrueInterest() ALWAYS runs before this.
 *    When calling this function, event RepayBorrow, and event Transfer will be called every
 *    time. This means we can ignore repayAmount. Seize tokens only changes state
 *    of the xTokens, which is covered by transfer. Therefore we only
 *    add liquidation counts in this handler.
 */
export function handleLiquidateBorrow(event: LiquidateBorrow): void {
  let liquidatorID = event.params.liquidator.toHex()
  let liquidator = Account.load(liquidatorID)
  if (liquidator == null) {
    liquidator = createAccount(liquidatorID)
  }
  liquidator.countLiquidator = liquidator.countLiquidator + 1
  liquidator.save()

  let borrowerID = event.params.borrower.toHex()
  let borrower = Account.load(borrowerID)
  if (borrower == null) {
    borrower = createAccount(borrowerID)
  }
  borrower.countLiquidated = borrower.countLiquidated + 1
  borrower.save()

  // For a liquidation, the liquidator pays down the borrow of the underlying
  // asset. They seize one of potentially many types of xToken collateral of
  // the underwater borrower. So we must get that address from the event, and
  // the repay token is the event.address
  let marketRepayToken = Market.load(event.address.toHexString())
  if (!marketRepayToken) {
    marketRepayToken = createMarket(event.address.toHexString())
  }
  let marketXTokenLiquidated = Market.load(event.params.cTokenCollateral.toHexString())
  if (!marketXTokenLiquidated) {
    marketXTokenLiquidated = createMarket(event.params.cTokenCollateral.toHexString())
  }
  let mintID = event.transaction.hash
    .toHexString()
    .concat('-')
    .concat(event.transactionLogIndex.toString())

  let xTokenAmount = event.params.seizeTokens
    .toBigDecimal()
    .div(xTokenDecimalsBD)
    .truncate(xTokenDecimals)
  let underlyingRepayAmount = event.params.repayAmount
    .toBigDecimal()
    .div(exponentToBigDecimal(marketRepayToken.underlyingDecimals))
    .truncate(marketRepayToken.underlyingDecimals)

  let liquidation = new LiquidationEvent(mintID)
  liquidation.amount = xTokenAmount
  liquidation.to = event.params.liquidator
  liquidation.from = event.params.borrower
  liquidation.blockNumber = event.block.number.toI32()
  liquidation.blockTime = event.block.timestamp.toI32()
  liquidation.underlyingSymbol = marketRepayToken.underlyingSymbol
  liquidation.underlyingRepayAmount = underlyingRepayAmount
  liquidation.xTokenSymbol = marketXTokenLiquidated.symbol
  liquidation.save()
}

/* Transferring of xTokens
 *
 * event.params.from = sender of xTokens
 * event.params.to = receiver of xTokens
 * event.params.amount = amount sent
 *
 * Notes
 *    Possible ways to emit Transfer:
 *      seize() - i.e. a Liquidation Transfer (does not emit anything else)
 *      redeemFresh() - i.e. redeeming your xTokens for underlying asset
 *      mintFresh() - i.e. you are lending underlying assets to create vtokens
 *      transfer() - i.e. a basic transfer
 *    This function handles all 4 cases. Transfer is emitted alongside the mint, redeem, and seize
 *    events. So for those events, we do not update xToken balances.
 */
export function handleTransfer(event: Transfer): void {
  // We only updateMarket() if accrual block number is not up to date. This will only happen
  // with normal transfers, since mint, redeem, and seize transfers will already run updateMarket()
  let marketID = event.address.toHexString()
  let market = Market.load(marketID)
  if (!market) {
    market = createMarket(marketID)
  }
  if (market.accrualBlockNumber != event.block.number.toI32()) {
    market = updateMarket(
      event.address,
      event.block.number.toI32(),
      event.block.timestamp.toI32(),
    )
  }

  let amountUnderlying = market.exchangeRate.times(
    event.params.amount.toBigDecimal().div(xTokenDecimalsBD),
  )
  let amountUnderylingTruncated = amountUnderlying.truncate(market.underlyingDecimals)

  // Checking if the tx is FROM the xToken contract (i.e. this will not run when minting)
  // If so, it is a mint, and we don't need to run these calculations
  let accountFromID = event.params.from.toHex()
  if (accountFromID != marketID) {
    let accountFrom = Account.load(accountFromID)
    if (accountFrom == null) {
      createAccount(accountFromID)
    }

    // Update xTokenStats common for all events, and return the stats to update unique
    // values for each event
    let xTokenStatsFrom = updateCommonXTokenStats(
      market.id,
      market.symbol,
      accountFromID,
      event.transaction.hash,
      event.block.timestamp,
      event.block.number,
      event.logIndex,
    )

    xTokenStatsFrom.xTokenBalance = xTokenStatsFrom.xTokenBalance.minus(
      event.params.amount
        .toBigDecimal()
        .div(xTokenDecimalsBD)
        .truncate(xTokenDecimals),
    )

    xTokenStatsFrom.totalUnderlyingRedeemed = xTokenStatsFrom.totalUnderlyingRedeemed.plus(
      amountUnderylingTruncated,
    )
    xTokenStatsFrom.save()
  }

  // Checking if the tx is TO the xToken contract (i.e. this will not run when redeeming)
  // If so, we ignore it. this leaves an edge case, where someone who accidentally sends
  // xTokens to a xToken contract, where it will not get recorded. Right now it would
  // be messy to include, so we are leaving it out for now TODO fix this in future
  let accountToID = event.params.to.toHex()
  if (accountToID != marketID) {
    let accountTo = Account.load(accountToID)
    if (accountTo == null) {
      createAccount(accountToID)
    }

    // Update xTokenStats common for all events, and return the stats to update unique
    // values for each event
    let xTokenStatsTo = updateCommonXTokenStats(
      market.id,
      market.symbol,
      accountToID,
      event.transaction.hash,
      event.block.timestamp,
      event.block.number,
      event.logIndex,
    )

    xTokenStatsTo.xTokenBalance = xTokenStatsTo.xTokenBalance.plus(
      event.params.amount
        .toBigDecimal()
        .div(xTokenDecimalsBD)
        .truncate(xTokenDecimals),
    )

    xTokenStatsTo.totalUnderlyingSupplied = xTokenStatsTo.totalUnderlyingSupplied.plus(
      amountUnderylingTruncated,
    )
    xTokenStatsTo.save()
  }

  let transferID = event.transaction.hash
    .toHexString()
    .concat('-')
    .concat(event.transactionLogIndex.toString())

  let transfer = new TransferEvent(transferID)
  transfer.amount = event.params.amount.toBigDecimal().div(xTokenDecimalsBD)
  transfer.to = event.params.to
  transfer.from = event.params.from
  transfer.blockNumber = event.block.number.toI32()
  transfer.blockTime = event.block.timestamp.toI32()
  transfer.xTokenSymbol = market.symbol
  transfer.save()
}

export function handleAccrueInterest(event: AccrueInterest): void {
  updateMarket(event.address, event.block.number.toI32(), event.block.timestamp.toI32())
}

export function handleNewReserveFactor(event: NewReserveFactor): void {
  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  if (!market) {
    market = createMarket(marketID)
  }
  market.reserveFactor = event.params.newReserveFactorMantissa
  market.save()
}

export function handleNewMarketInterestRateModel(
  event: NewMarketInterestRateModel,
): void {
  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  if (market == null) {
    market = createMarket(marketID)
  }
  market.interestRateModelAddress = event.params.newInterestRateModel
  market.save()
}
