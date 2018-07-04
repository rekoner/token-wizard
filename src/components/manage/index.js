import React, { Component } from 'react'
import { inject, observer } from 'mobx-react'
import { TOAST } from '../../utils/constants'
import '../../assets/stylesheets/application.css'
import {
  successfulFinalizeAlert,
  successfulUpdateCrowdsaleAlert,
  warningOnFinalizeCrowdsale,
  notTheOwner,
  invalidNetworkIDAlert,
  invalidCrowdsaleExecIDAlert
} from '../../utils/alerts'
import {
  getCurrentAccount,
  getNetworkVersion,
  sendTXToContract,
  calculateGasLimit,
  attachToSpecificCrowdsaleContract,
  methodToExec,
  getCrowdsaleStrategy,
  checkWeb3,
  isAddressValid
} from '../../utils/blockchainHelpers'
import { isExecIDValid, isNetworkIDValid, toast, toBigNumber } from '../../utils/utils'
import { getCrowdsaleAssets } from '../../stores/utils'
import { getFieldsToUpdate, processTier, updateTierAttribute } from './utils'
import { Loader } from '../Common/Loader'
import { getTiersLength } from '../crowdsale/utils'
import { Form } from 'react-final-form'
import arrayMutators from 'final-form-arrays'
import createDecorator from 'final-form-calculate'
import { FinalizeCrowdsaleStep } from './FinalizeCrowdsaleStep'
import { ReservedTokensList } from './ReservedTokensList'
import { ManageForm } from './ManageForm'
import moment from 'moment'
import logdown from 'logdown'

const logger = logdown('TW:manage')

@inject('crowdsaleStore', 'web3Store', 'tierStore', 'contractStore', 'generalStore', 'tokenStore', 'gasPriceStore')
@observer
export class Manage extends Component {
  constructor(props) {
    super(props)
    this.state = {
      loading: true,
      canFinalize: false,
      ownerCurrentUser: false,
      crowdsaleHasEnded: true,
      crowdsaleHasStarted: false,
      crowdsaleIsUpdatable: false,
      crowdsaleIsWhitelisted: false,
      crowdsaleIsFinalized: false
    }

    this.initialValues = {
      tiers: [],
      minCap: 0
    }
  }

  componentDidMount() {
    setTimeout(() => window.scrollTo(0, 0), 500)
  }

  componentWillMount() {
    const { crowdsaleStore, generalStore, tierStore } = this.props

    this.validateEnvironment()
      .then(() => getCrowdsaleAssets(generalStore.networkID))
      .then(() => getCrowdsaleStrategy(crowdsaleStore.execID))
      .then(strategy => crowdsaleStore.setProperty('strategy', strategy))
      .then(() => this.checkOwner())
      .then(() => this.extractContractsData())
      .then(() => this.updateCrowdsaleStatus())
      .then(() => {
        this.initialValues.tiers = JSON.parse(JSON.stringify(tierStore.tiers))
        this.initialValues.minCap = +tierStore.tiers[0].minCap
      })
      .catch(err => logger.error(err))
      .then(() => {
        this.hideLoader()
        if (!this.state.ownerCurrentUser) notTheOwner()
      })
  }

  validateEnvironment = async () => {
    const { generalStore, crowdsaleStore, contractStore, web3Store, match } = this.props

    await checkWeb3()

    if (!web3Store.web3) {
      return Promise.reject('no web3 available')
    }

    const networkID = await getNetworkVersion()
    generalStore.setProperty('networkID', networkID)

    if (!isNetworkIDValid(networkID)) {
      invalidNetworkIDAlert()
      return Promise.reject('invalid networkID')
    }

    const { crowdsalePointer } = match.params
    if (isExecIDValid(crowdsalePointer)) {
      crowdsaleStore.setSelectedProperty('execID', crowdsalePointer)
      crowdsaleStore.setProperty('execID', crowdsalePointer)
      contractStore.setContractProperty('crowdsale', 'execID', crowdsalePointer)
    } else if (isAddressValid(crowdsalePointer)) {
      crowdsaleStore.setSelectedProperty('addr', crowdsalePointer)
      crowdsaleStore.setProperty('addr', crowdsalePointer)
      contractStore.setContractProperty(crowdsaleStore.proxyName, 'addr', crowdsalePointer)
    }

    //todo: 2 alerts
    if (!isExecIDValid(crowdsalePointer) && !isAddressValid(crowdsalePointer)) {
      invalidCrowdsaleExecIDAlert()
      return Promise.reject('invalid exec-id or proxy addr')
    }
  }

  componentWillUnmount() {
    const { tierStore, tokenStore, crowdsaleStore } = this.props
    tierStore.reset()
    tokenStore.reset()
    crowdsaleStore.reset()
  }

  checkOwner = async () => {
    const { contractStore, crowdsaleStore } = this.props

    let target
    if (crowdsaleStore.execID) {
      const targetPrefix = 'idx'
      const targetSuffix = crowdsaleStore.contractTargetSuffix
      target = `${targetPrefix}${targetSuffix}`
    } else {
      target = crowdsaleStore.proxyName
    }

    const { methods } = await attachToSpecificCrowdsaleContract(target)
    const { addr } = contractStore.abstractStorage
    const { execID } = crowdsaleStore
    let ownerAccount = await methods.getAdmin(addr, execID).call()
    const account = await getCurrentAccount()

    const ownerCurrentUser = account === ownerAccount
    this.setState({ ownerCurrentUser })
    contractStore.setContractProperty('crowdsale', 'account', account)
  }

  extractContractsData = async () => {
    try {
      const { crowdsaleStore, contractStore, tierStore } = this.props
      const { addr: abstractStorageAddr } = contractStore.abstractStorage
      const { isMintedCappedCrowdsale, isDutchAuction, execID, contractTargetSuffix } = crowdsaleStore

      const num_of_tiers = await getTiersLength()
      logger.log('num_of_tiers:', num_of_tiers)

      let target
      if (execID) {
        target = `idx${contractTargetSuffix}`
      } else {
        target = crowdsaleStore.proxyName
      }

      const { methods } = await attachToSpecificCrowdsaleContract(target)
      const {
        getCrowdsaleInfo,
        getTokenInfo,
        getReservedTokenDestinationList,
        getCrowdsaleTier,
        getTierStartAndEndDates,
        getCrowdsaleStatus,
        getCrowdsaleStartAndEndTimes,
        getReservedDestinationInfo,
        getTierWhitelist,
        getWhitelistStatus,
        getCrowdsaleWhitelist,
        getTokensSold
      } = methods

      let params = []
      if (execID) {
        params.push(abstractStorageAddr, execID)
      }

      let crowdsale = await getCrowdsaleInfo(...params).call()
      if (crowdsale && !crowdsale.hasOwnProperty('wei_raised')) {
        crowdsale.wei_raised = crowdsale[0]
      }
      if (crowdsale && !crowdsale.hasOwnProperty('team_wallet')) {
        crowdsale.team_wallet = crowdsale[1]
      }
      if (isMintedCappedCrowdsale) {
        if (crowdsale && !crowdsale.hasOwnProperty('is_initialized')) {
          crowdsale.is_initialized = crowdsale[2]
        }
        if (crowdsale && !crowdsale.hasOwnProperty('is_finalized')) {
          crowdsale.is_finalized = crowdsale[3]
        }
      } else if (isDutchAuction) {
        if (crowdsale && !crowdsale.hasOwnProperty('minimum_contribution')) {
          crowdsale.minimum_contribution = crowdsale[2]
        }
        if (crowdsale && !crowdsale.hasOwnProperty('is_initialized')) {
          crowdsale.is_initialized = crowdsale[3]
        }
        if (crowdsale && !crowdsale.hasOwnProperty('is_finalized')) {
          crowdsale.is_finalized = crowdsale[4]
        }
        if (crowdsale && !crowdsale.hasOwnProperty('burn_excess')) {
          crowdsale.burn_excess = crowdsale[5]
        }
      }
      let token
      if (getTokenInfo) {
        token = await getTokenInfo(...params).call()
      } else {
        //for Proxy
        const token_name = await methods.name(...params).call()
        const token_symbol = await methods.symbol(...params).call()
        const token_decimals = await methods.decimals(...params).call()
        const total_supply = await methods.totalSupply(...params).call()
        token = {
          token_name,
          token_symbol,
          token_decimals,
          total_supply
        }
      }

      const tiers = []
      const reserved_tokens_info = []

      if (isMintedCappedCrowdsale) {
        for (let tier_num = 0; tier_num < num_of_tiers; tier_num++) {
          let tier_data = await getCrowdsaleTier(...params, tier_num).call()
          if (tier_data && !tier_data.hasOwnProperty('tier_name')) {
            tier_data.tier_name = tier_data[0]
          }
          if (tier_data && !tier_data.hasOwnProperty('tier_sell_cap')) {
            tier_data.tier_sell_cap = tier_data[1]
          }
          if (tier_data && !tier_data.hasOwnProperty('tier_price')) {
            tier_data.tier_price = tier_data[2]
          }
          if (tier_data && !tier_data.hasOwnProperty('tier_min')) {
            tier_data.tier_min = tier_data[3]
          }

          if (tier_data && !tier_data.hasOwnProperty('tier_duration')) {
            tier_data.tier_duration = tier_data[4]
          }

          if (tier_data && !tier_data.hasOwnProperty('duration_is_modifiable')) {
            tier_data.duration_is_modifiable = tier_data[5]
          }
          if (tier_data && !tier_data.hasOwnProperty('is_whitelisted')) {
            tier_data.is_whitelisted = tier_data[6]
          }

          let tier_dates = await getTierStartAndEndDates(...params, tier_num).call()
          if (tier_dates && !tier_dates.hasOwnProperty('tier_start')) {
            tier_dates.tier_start = tier_dates[0]
          }
          if (tier_dates && !tier_dates.hasOwnProperty('tier_end')) {
            tier_dates.tier_end = tier_dates[1]
          }

          if (tier_data.is_whitelisted) {
            let tierWhitelist = await getTierWhitelist(...params, tier_num).call()
            if (tierWhitelist && !tierWhitelist.hasOwnProperty('num_whitelisted')) {
              tierWhitelist.num_whitelisted = tierWhitelist[0]
            }
            if (tierWhitelist && !tierWhitelist.hasOwnProperty('whitelist')) {
              tierWhitelist.whitelist = tierWhitelist[1]
            }
            const whitelist = (tierWhitelist && tierWhitelist.whitelist) || []

            logger.log('whitelist:', whitelist)

            for (let whitelist_item_index = 0; whitelist_item_index < whitelist.length; whitelist_item_index++) {
              const whitelist_item_addr = whitelist[whitelist_item_index]
              let whitelistStatus = await getWhitelistStatus(...params, tier_num, whitelist_item_addr).call()
              if (whitelistStatus && !whitelistStatus.hasOwnProperty('minimum_purchase_amt')) {
                whitelistStatus.minimum_purchase_amt = whitelistStatus[0]
              }
              if (whitelistStatus && !whitelistStatus.hasOwnProperty('max_tokens_remaining')) {
                whitelistStatus.max_tokens_remaining = whitelistStatus[0]
              }
              const { max_tokens_remaining, minimum_purchase_amt: minimum_contribution } = whitelistStatus

              if (max_tokens_remaining > 0) {
                if (!tier_data.whitelist) tier_data.whitelist = []

                tier_data.whitelist.push({
                  addr: whitelist_item_addr,
                  min: minimum_contribution,
                  max: max_tokens_remaining
                })
              }
            }
          }

          tiers.push(Object.assign(tier_data, tier_dates))
        }

        let reservedTokenDestinationList = await getReservedTokenDestinationList(...params).call()
        if (reservedTokenDestinationList && !reservedTokenDestinationList.hasOwnProperty('num_destinations')) {
          reservedTokenDestinationList.num_destinations = reservedTokenDestinationList[0]
        }
        if (reservedTokenDestinationList && !reservedTokenDestinationList.hasOwnProperty('reserved_destinations')) {
          reservedTokenDestinationList.reserved_destinations = reservedTokenDestinationList[0]
        }

        const reserved_destinations =
          reservedTokenDestinationList &&
          (reservedTokenDestinationList.reserved_destinations || reservedTokenDestinationList[1])
        if (reserved_destinations) {
          for (let destination_index = 0; destination_index < reserved_destinations.length; destination_index++) {
            const reserved_addr = reserved_destinations[destination_index]
            let reservedDestinationInfo = await getReservedDestinationInfo(...params, reserved_addr).call()
            if (reservedDestinationInfo && !reservedDestinationInfo.hasOwnProperty('destination_list_index')) {
              reservedDestinationInfo.destination_list_index = reservedDestinationInfo[0]
            }
            if (reservedDestinationInfo && !reservedDestinationInfo.hasOwnProperty('num_tokens')) {
              reservedDestinationInfo.num_tokens = reservedDestinationInfo[1]
            }
            if (reservedDestinationInfo && !reservedDestinationInfo.hasOwnProperty('num_percent')) {
              reservedDestinationInfo.num_percent = reservedDestinationInfo[2]
            }
            if (reservedDestinationInfo && !reservedDestinationInfo.hasOwnProperty('percent_decimals')) {
              reservedDestinationInfo.percent_decimals = reservedDestinationInfo[3]
            }
            const { num_tokens, num_percent, percent_decimals } = reservedDestinationInfo

            if (num_tokens > 0) {
              reserved_tokens_info.push({
                addr: reserved_addr,
                dim: 'tokens',
                val: toBigNumber(num_tokens)
                  .times(`1e-${token.token_decimals}`)
                  .toFixed()
              })
            }

            if (num_percent > 0) {
              reserved_tokens_info.push({
                addr: reserved_addr,
                dim: 'percentage',
                val: toBigNumber(num_percent)
                  .times(`1e-${percent_decimals}`)
                  .toFixed()
              })
            }
          }
        }
      } else if (isDutchAuction) {
        const tier_data = await getCrowdsaleStatus(...params).call()

        if (tier_data && !tier_data.hasOwnProperty('is_whitelisted')) {
          tier_data.is_whitelisted = tier_data[6]
        }
        if (tier_data && !tier_data.hasOwnProperty('min_cap')) {
          tier_data.tier_min = crowdsale.minimum_contribution
        }

        const tier_dates = await getCrowdsaleStartAndEndTimes(...params).call()
        const crowdsaleWhitelist = await getCrowdsaleWhitelist(...params).call()
        const whitelist = crowdsaleWhitelist.whitelist || crowdsaleWhitelist[1]
        const tokens_sold = await getTokensSold(...params).call()

        if (tier_data.is_whitelisted) {
          for (let whitelist_item_index = 0; whitelist_item_index < whitelist.length; whitelist_item_index++) {
            const whitelist_item_addr = whitelist[whitelist_item_index]
            const whitelistStatus = await getWhitelistStatus(...params, whitelist_item_addr).call()
            const max_tokens_remaining = whitelistStatus.max_tokens_remaining || whitelistStatus[1]
            const minimum_contribution = whitelistStatus.minimum_purchase_amt || whitelistStatus[0]

            if (max_tokens_remaining > 0) {
              if (!tier_data.whitelist) tier_data.whitelist = []

              tier_data.whitelist.push({
                addr: whitelist_item_addr,
                min: minimum_contribution,
                max: max_tokens_remaining
              })
            }
          }
        }

        tiers.push(Object.assign(tier_data, tier_dates, tokens_sold))
      }

      logger.log('tiers:', tiers)

      tiers.forEach((tier, index) => processTier(crowdsale, token, reserved_tokens_info, tier, index))
    } catch (err) {
      return Promise.reject(err)
    }
  }

  hideLoader = err => {
    if (err) {
      logger.log(err)
    }
    this.setState({ loading: false })
  }

  showLoader = () => {
    this.setState({ loading: true })
  }

  updateCrowdsaleStatus = () => {
    return this.setCrowdsaleInfo()
      .then(this.canFinalize)
      .then(this.checkOwner)
  }

  setCrowdsaleInfo = async () => {
    const { contractStore, crowdsaleStore } = this.props
    const { execID, selected, isMintedCappedCrowdsale, isDutchAuction } = crowdsaleStore
    const { addr } = contractStore.abstractStorage
    const { initialTiersValues } = selected

    let params = []
    if (execID) {
      params.push(addr, execID)
    }

    let target
    if (crowdsaleStore.execID) {
      const targetPrefix = 'idx'
      const targetSuffix = crowdsaleStore.contractTargetSuffix
      target = `${targetPrefix}${targetSuffix}`
    } else {
      target = crowdsaleStore.proxyName
    }

    const { methods } = await attachToSpecificCrowdsaleContract(target)
    const { getCrowdsaleStartAndEndTimes, getCrowdsaleInfo } = methods
    let crowdsaleStartAndEndTimes = await getCrowdsaleStartAndEndTimes(...params).call()
    if (crowdsaleStartAndEndTimes && crowdsaleStartAndEndTimes.hasOwnProperty('start_time')) {
      crowdsaleStartAndEndTimes.start_time = crowdsaleStartAndEndTimes[0]
    }
    if (crowdsaleStartAndEndTimes && crowdsaleStartAndEndTimes.hasOwnProperty('end_time')) {
      crowdsaleStartAndEndTimes.end_time = crowdsaleStartAndEndTimes[1]
    }
    const { start_time, end_time } = await getCrowdsaleStartAndEndTimes(...params).call()
    let crowdsaleInfo = await getCrowdsaleInfo(...params).call()

    if (isMintedCappedCrowdsale && crowdsaleInfo && !crowdsaleInfo.hasOwnProperty('is_finalized')) {
      crowdsaleInfo.is_finalized = crowdsaleInfo[3]
    } else if (isDutchAuction && crowdsaleInfo && !crowdsaleInfo.hasOwnProperty('is_finalized')) {
      crowdsaleInfo.is_finalized = crowdsaleInfo[4]
    }
    const { is_finalized } = crowdsaleInfo

    this.setState({
      crowdsaleHasEnded: end_time * 1000 <= Date.now(),
      crowdsaleHasStarted: start_time * 1000 >= Date.now(),
      crowdsaleIsUpdatable: initialTiersValues.some(tier => tier.updatable),
      crowdsaleIsWhitelisted: initialTiersValues.some(tier => tier.isWhitelisted),
      crowdsaleIsFinalized: is_finalized
    })
  }

  canFinalize = async () => {
    const { contractStore, crowdsaleStore } = this.props
    const { addr } = contractStore.abstractStorage
    const { execID, contractTargetSuffix } = crowdsaleStore

    let params = []
    if (execID) {
      params.push(addr, execID)
    }

    let target
    if (execID) {
      const targetPrefix = 'idx'
      const targetSuffix = contractTargetSuffix
      target = `${targetPrefix}${targetSuffix}`
    } else {
      target = crowdsaleStore.proxyName
    }

    const { methods } = await attachToSpecificCrowdsaleContract(target)
    const { getCrowdsaleInfo, isCrowdsaleFull } = methods

    try {
      let crowdsaleInfo = await getCrowdsaleInfo(...params).call()
      if (crowdsaleInfo && crowdsaleInfo.hasOwnProperty('is_finalized')) {
        crowdsaleInfo.is_finalized = crowdsaleInfo[4]
      }
      const { is_finalized } = crowdsaleInfo
      let _isCrowdsaleFull = await isCrowdsaleFull(...params).call()
      if (_isCrowdsaleFull && _isCrowdsaleFull.hasOwnProperty('is_crowdsale_full')) {
        _isCrowdsaleFull.is_crowdsale_full = _isCrowdsaleFull[0]
      }
      const { is_crowdsale_full } = _isCrowdsaleFull
      const { crowdsaleHasEnded } = this.state

      if (is_finalized) {
        this.setState({ canFinalize: false })
      } else {
        this.setState({
          canFinalize: crowdsaleHasEnded || is_crowdsale_full
        })
      }
    } catch (e) {
      logger.error(e)
      this.setState({ canFinalize: false })
    }
  }

  getFinalizeCrowdsaleParams = methodInterface => {
    return this.props.web3Store.web3.eth.abi.encodeParameters(methodInterface, [])
  }

  finalizeCrowdsale = () => {
    this.updateCrowdsaleStatus()
      .then(() => {
        const { crowdsaleStore } = this.props

        if (!crowdsaleStore.selected.finalized && this.state.canFinalize) {
          warningOnFinalizeCrowdsale().then(result => {
            if (result.value) {
              this.showLoader()

              getCurrentAccount().then(account => {
                const methodInterface = []

                let methodName
                if (crowdsaleStore.isMintedCappedCrowdsale) {
                  methodName = 'finalizeCrowdsaleAndToken'
                } else if (crowdsaleStore.isDutchAuction) {
                  methodName = 'finalizeCrowdsale'
                }

                let paramsToExec = [methodInterface]
                let targetContractName
                if (crowdsaleStore.execID) {
                  targetContractName = 'registryExec'
                } else {
                  targetContractName = crowdsaleStore.proxyName
                }
                const method = methodToExec(
                  targetContractName,
                  `${methodName}(${methodInterface.join(',')})`,
                  this.getFinalizeCrowdsaleParams,
                  paramsToExec
                )

                let opts = {
                  gasPrice: this.props.generalStore.gasPrice,
                  from: account
                }

                method
                  .estimateGas(opts)
                  .then(estimatedGas => {
                    logger.log('estimatedGas:', estimatedGas)
                    opts.gasLimit = calculateGasLimit(estimatedGas)
                    return sendTXToContract(method.send(opts))
                  })
                  .then(() => {
                    crowdsaleStore.setSelectedProperty('finalized', true)
                    this.setState({ canFinalize: false }, () => {
                      successfulFinalizeAlert().then(() => {
                        this.setState({ loading: true })
                        setTimeout(() => window.location.reload(), 500)
                      })
                    })
                  })
                  .catch(err => {
                    logger.log(err)
                    toast.showToaster({ type: TOAST.TYPE.ERROR, message: TOAST.MESSAGE.FINALIZE_FAIL })
                  })
                  .then(this.hideLoader)
              })
            }
          })
        }
      })
      .catch(logger.error)
  }

  allTiersValid = () => {
    // TODO: review validations after this fix: https://github.com/final-form/react-final-form/issues/151
    // once done, can be replaced with _pristine_ state value
    const { initialTiersValues } = this.props.crowdsaleStore.selected
    const { individuallyValidTiers } = this.props.tierStore

    return initialTiersValues.every(tier => individuallyValidTiers[tier.index])
  }

  fieldsToUpdate = () => {
    const { initialTiersValues } = this.props.crowdsaleStore.selected
    const { tiers } = this.props.tierStore

    return this.allTiersValid() ? getFieldsToUpdate(initialTiersValues, tiers) : []
  }

  canSave = () => {
    const { loading, ownerCurrentUser, crowdsaleHasEnded } = this.state
    const fieldsToUpdate = this.fieldsToUpdate()

    return !loading && ownerCurrentUser && !!fieldsToUpdate.length && !crowdsaleHasEnded
  }

  saveDisplayed = () => {
    const { ownerCurrentUser, crowdsaleHasEnded, crowdsaleIsFinalized, canFinalize } = this.state
    return ownerCurrentUser && !crowdsaleHasEnded && (!crowdsaleIsFinalized || !canFinalize)
  }

  saveCrowdsale = () => {
    if (!this.canSave()) return

    this.showLoader()

    this.updateCrowdsaleStatus()
      .then(() => {
        const fieldsToUpdate = this.fieldsToUpdate()
        logger.log('fieldsToUpdate:', fieldsToUpdate)

        fieldsToUpdate
          .reduce((promise, { key, newValue, tier }) => {
            return promise.then(() => updateTierAttribute(key, newValue, tier))
          }, Promise.resolve())
          .then(() => {
            this.hideLoader()
            successfulUpdateCrowdsaleAlert()
          })
          .catch(err => {
            this.hideLoader(err)
            toast.showToaster({ type: TOAST.TYPE.ERROR, message: TOAST.MESSAGE.TRANSACTION_FAILED })
          })
      })
      .catch(error => {
        this.hideLoader(error)
      })
  }

  updateTierStore = ({ values }) => {
    const { tierStore } = this.props
    values.tiers.forEach((tier, index) => {
      tierStore.setTierProperty(tier.endTime, 'endTime', index)
      tierStore.setTierProperty(tier.minCap, 'minCap', index)
    })
  }

  calculator = createDecorator({
    field: /.+\.endTime/,
    updates: (value, name, allValues) => {
      const nextTierIndex = +name.match(/(\d+)/)[1] + 1
      const { tierStore } = this.props
      const newValue = {}

      if (tierStore.tiers[nextTierIndex]) {
        const currentEnd = moment(allValues.tiers[nextTierIndex].endTime)
        const currentStart = moment(allValues.tiers[nextTierIndex].startTime)
        const duration = moment.duration(currentEnd.diff(currentStart)).as('minutes')
        const nextEnd = moment(value)
          .add(duration, 'm')
          .format('YYYY-MM-DDTHH:mm')

        newValue[`tiers[${nextTierIndex}].startTime`] = value
        newValue[`tiers[${nextTierIndex}].endTime`] = nextEnd

        tierStore.setTierProperty(value, 'startTime', nextTierIndex)
        tierStore.setTierProperty(nextEnd, 'endTime', nextTierIndex)
      }

      return newValue
    }
  })

  render() {
    const {
      canFinalize,
      ownerCurrentUser,
      crowdsaleIsFinalized,
      crowdsaleHasEnded,
      crowdsaleIsWhitelisted
    } = this.state

    return (
      <section className="manage">
        <FinalizeCrowdsaleStep
          disabled={!ownerCurrentUser || crowdsaleIsFinalized || !canFinalize || crowdsaleHasEnded}
          handleClick={this.finalizeCrowdsale}
        />

        <ReservedTokensList owner={ownerCurrentUser} />

        <Form
          onSubmit={this.saveCrowdsale}
          mutators={{ ...arrayMutators }}
          decorators={[this.calculator]}
          initialValues={{ ...this.initialValues }}
          component={ManageForm}
          canEditTiers={ownerCurrentUser && !canFinalize && !crowdsaleIsFinalized}
          canEditMinCap={ownerCurrentUser && !crowdsaleHasEnded && !crowdsaleIsWhitelisted && !crowdsaleIsFinalized}
          handleChange={this.updateTierStore}
          canSave={this.canSave()}
          displaySave={this.saveDisplayed()}
        />

        <Loader show={this.state.loading} />
      </section>
    )
  }
}
