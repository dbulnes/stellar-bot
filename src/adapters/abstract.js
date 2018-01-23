const utils = require('../utils')
const Big = require('big.js')
const StellarSdk = require('stellar-sdk')
const EventEmitter = require('events')
const Promise = require('../../node_modules/bluebird')

class Adapter extends EventEmitter {

  constructor (config) {
    super()

    this.config = config

    this.Account = config.models.account

    this.Account.events.on('DEPOSIT', (sourceAccount, amount) => {
      if (this.name === sourceAccount.adapter) {
        this.onDeposit(sourceAccount, amount.toFixed(7))
      }
    })
  }

  // *** +++ Deposit Hook Functions +
  async onDeposit (sourceAccount, amount) {
    // Override this or listen to events!
    this.emit('deposit', sourceAccount, amount)
  }

  /**
   *
   * @param potentialTip {Tip} The Command.Tip object created from the tip request
   * @param amount The tip amount fixed to 7 decimal places
   * @returns {Promise<void>}
   */
  async onTipWithInsufficientBalance (potentialTip, amount) {
    // Override this or listen to events!
    this.emit('tipWithInsufficientBalance', potentialTip, amount)
  }

  /**
   *
   * @param potentialTip {Tip} The Command.Tip object created from the tip request
   * @param amount The tip amount fixed to 7 decimal places
   * @returns {Promise<void>}
   */
  async onTipTransferFailed (potentialTip, amount) {
    // Override this or listen to events!
    this.emit('tipTransferFailed', potentialTip, amount)
  }

  /**
   *
   * @param potentialTip {Tip} The Command.Tip object created from the tip request
   * @param amount The tip amount fixed to 7 decimal places
   * @returns {Promise<void>}
   */
  async onTipReferenceError (potentialTip, amount) {
    // Override this or listen to events!
    this.emit('tipReferenceError', potentialTip, amount)
  }

  /**
   *
   * @param potentialTip {Tip} The Command.Tip object created from the tip request
   * @param amount The tip amount fixed to 7 decimal places
   * @returns {Promise<void>}
   */
  async onTip (potentialTip, amount) {
    // Override this or listen to events!
    this.emit('tip', potentialTip, amount)
  }

  // *** +++ Withdrawael Hook Functions +
  /**
   *
   * @param withdrawal {Withdraw}
   * @returns {Promise<void>}
   */
  async onWithdrawalReferenceError (withdrawal) {
    // Override this or listen to events!
    this.emit('withdrawalReferenceError', withdrawal.uniqueId, withdrawal.address, withdrawal.amount, withdrawal.hash)
  }

  async onWithdrawalDestinationAccountDoesNotExist (withdrawal) {
    // Override this or listen to events!
    this.emit('withdrawalDestinationAccountDoesNotExist', withdrawal.uniqueId, withdrawal.address, withdrawal.amount, withdrawal.hash)
  }

  async onWithdrawalNoAddressProvided (withdrawal) {
    // Override this or listen to events!
    this.emit('withdrawalNoAddressProvided', withdrawal.uniqueId, withdrawal.address, withdrawal.amount, withdrawal.hash)
  }

  async onWithdrawalInvalidAmountProvided (withdrawal) {
    // Override this or listen to events!
    this.emit('withdrawalInvalidAmountProvided', withdrawal.uniqueId, withdrawal.address, withdrawal.amount, withdrawal.hash)
  }

  async onWithdrawalFailedWithInsufficientBalance (amountRequested, balance) {
    // Override this or listen to events!
    this.emit('withdrawalFailedWithInsufficientBalance', amountRequested, balance)
  }

  async onWithdrawalSubmissionFailed (withdrawal) {
    // Override this or listen to events!
    this.emit('withdrawalSubmissionFailed', withdrawal.uniqueId, withdrawal.address, withdrawal.amount, withdrawal.hash)
  }

  async onWithdrawalInvalidAddress (withdrawal) {
    // Override this or listen to events!
   this.emit('withdrawalInvalidAddress', withdrawal.uniqueId, withdrawal.address, withdrawal.amount, withdrawal.hash)
  }

  async onWithdrawal (withdrawal, address) {
    // Override this or listen to events!
    this.emit('withdrawal', withdrawal.uniqueId, address, withdrawal.amount, withdrawal.hash)
  }

  // *** +++ Registration related functions +
  async onRegistrationBadWallet (walletAddressGiven) {
    return `${walletAddressGiven} is not a valid Public Key / wallet address`
  }

  async onRegistrationReplacedOldWallet(oldWallet, newWallet) {
    return `Your old wallet \`${oldWallet}\` has been replaced by \`${newWallet}\``
  }

  async onRegistrationSameAsExistingWallet(walletAddress) {
    return `You are already using the public key \`${walletAddress}\``
  }

  async onRegistrationOtherUserHasRegisteredWallet(walletAddress) {
    // TODO: Factor contact info out into env vars or something
    return `Another user has already registered the wallet address \`${walletAddress}\`. If you think this is a mistake, please contact @dlohnes on Slack.`
  }

  async onRegistrationRegisteredFirstWallet(walletAddress) {
    return `Successfully registered with wallet address \`${walletAddress}\`.\n\nSend XLM deposits to \`${process.env.STELLAR_PUBLIC_KEY}\` to make funds available for use with the '/tip' command.`
  }

  /**
   *  Should receive a Command.Tip object
   */
  async receivePotentialTip (tip) {
      // Let's see if the source has a sufficient balance
      const source = await this.Account.getOrCreate(tip.adapter, tip.sourceId)
      const payment = new Big(tip.amount)
      const hash = tip.hash

      if (!source.canPay(payment)) {
        return this.onTipWithInsufficientBalance(tip, payment.toFixed(7))
      }

      if (tip.sourceId === tip.targetId) {
        return this.onTipReferenceError(tip, payment.toFixed(7))
      }

      const target = await this.Account.getOrCreate(tip.adapter, tip.targetId)

      // ... and tip.
    try {
        await source.transfer(target, payment, hash)
        return this.onTip(tip, payment.toFixed(7))
    } catch (exc) {
        if (exc !== 'DUPLICATE_TRANSFER') {
          this.onTipTransferFailed(tip, payment.toFixed(7))
        }
    }
  }

  /**
   * Returns the balance for the requested adapter / uniqueId combination.
   *
   * A fresh account with an initial balance of zero is created if it does not exist.
   */
  requestBalance (adapter, uniqueId) {
    return new Promise(async (resolve, reject) => {
      const target = await this.Account.getOrCreate(adapter, uniqueId)
      resolve(target.balance)
    })
  }

  /**
   *
   * @param withdrawalRequest {Withdraw}
   * @returns {Promise<void>}
   */
  async receiveWithdrawalRequest (withdrawalRequest) {
    const adapter = withdrawalRequest.adapter
    const uniqueId = withdrawalRequest.uniqueId
    const hash = withdrawalRequest.hash
    const address = withdrawalRequest.address || await this.Account.walletAddressForUser(adapter, uniqueId)
    const amountRequested = withdrawalRequest.amount
    let withdrawalAmount;
    try {
      withdrawalAmount = new Big(amountRequested)
    } catch (e) {
      console.log(`Bad data fed to new Big() in Adapter::receiveWithdrawalRequest()\n${JSON.stringify(e)}`)
      console.log(`Withdrawal request amount is ${amountRequested}`)
      return this.onWithdrawalInvalidAmountProvided(withdrawalRequest)
    }
    const fixedAmount = withdrawalAmount.toFixed(7)

    if(typeof address === 'undefined' || address === null) {
      return this.onWithdrawalNoAddressProvided(uniqueId, address, fixedAmount, hash)
    }


    if (!StellarSdk.StrKey.isValidEd25519PublicKey(address)) {
      return this.onWithdrawalInvalidAddress(withdrawalRequest)
    }

    // Fetch the account
    const target = await this.Account.getOrCreate(adapter, uniqueId)
    if (!target.canPay(withdrawalAmount)) {
      return this.onWithdrawalFailedWithInsufficientBalance(fixedAmount, target.balance)
    }

    // Withdraw
    try {
      await target.withdraw(this.config.stellar, address, withdrawalAmount, hash)
      return this.onWithdrawal(withdrawalRequest, address)
    } catch (exc) {
      if (exc === 'WITHDRAWAL_DESTINATION_ACCOUNT_DOES_NOT_EXIST') {
        return this.onWithdrawalDestinationAccountDoesNotExist(uniqueId, address, fixedAmount, hash)
      }
      if (exc === 'WITHDRAWAL_REFERENCE_ERROR') {
        return this.onWithdrawalReferenceError(uniqueId, address, fixedAmount, hash)
      }
      if (exc === 'WITHDRAWAL_SUBMISSION_FAILED') {
        return this.onWithdrawalSubmissionFailed(uniqueId, address, fixedAmount, hash)
      }
      // throw (exc)
    }
  }

  /**
   *
   * @param cmd {Balance}
   * @returns {Promise<void>}
   */
  async receiveBalanceRequest (cmd) {
    this.emit('receiveBalanceRequest', cmd)
  }

  /**
   * Validates the options provided and gives back an objet wher the key is the request option
   * and the value is the value which will be set on an account.
   *
   * Feel free to do any validation you like. Just be sure to handle errors / rejections to your liking.
   *
   * Technically 'options' can look like anything you want, but right now we only support changing wallet address.
   *
   * {
   *     walletAddress: 'GDTWLOWE34LFHN4Z3LCF2EGAMWK6IHVAFO65YYRX5TMTER4MHUJIWQKB',
   * }
   *
   */
    setAccountOptions(options) {
      let walletAddr = options.walletAddress
      if(!StellarSdk.StrKey.isValidEd25519PublicKey(walletAddr)) {
        throw new Error("setAccountOptions was given a bad public key")
      }
      // We could just return `options` here, but in the interest
      // of future proofing / illustrating what we're more likely to do later as
      // options are added...
      return {walletAddress : walletAddr}
  }
}

module.exports = Adapter