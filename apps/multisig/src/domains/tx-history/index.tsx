import { DUMMY_MULTISIG_ID, Transaction, extrinsicToDecoded, useSelectedMultisig } from '@domains/multisig'
import { Vec, GenericExtrinsic } from '@polkadot/types'
import { AnyTuple } from '@polkadot/types-codec/types'
import { gql } from 'graphql-request'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { atom, useRecoilState, useRecoilValue, useRecoilValueLoadable } from 'recoil'
import fetchGraphQL from '../../graphql/fetch-graphql'
import { Address } from '../../util/addresses'
import { useApi } from '../chains/pjs-api'
import { txMetadataByTeamIdState } from '../offchain-data/metadata'
import { makeTransactionID } from '../../util/misc'
import { allChainTokensSelector, decodeCallData } from '../chains'

interface RawResponse {
  data: {
    accountExtrinsics: {
      extrinsic: {
        id: string
        index: number
        callName: string
        callArgs: any
        signer: string
        block: {
          hash: string
          timestamp: string
          height: string
          chainGenesisHash: string
        }
      }
    }[]
  }
}

type ParsedTransaction = {
  block: {
    hash: string
    height: number
    timestamp: number
  }
  call: {
    name: string
    args: any
  }
  indexInBlock: number
  error?: string
  signer: string
}

export const rawConfirmedTransactionsState = atom<Record<string, { transactions: ParsedTransaction[] }>>({
  key: 'confirmedTransactionsState',
  default: {},
})

// set this to true after a tx is made
export const unknownConfirmedTransactionsState = atom<string[]>({
  key: 'unknownConfirmedTransactionsState',
  default: [],
})

type Variables = {
  vaultPublicKey: string
  chainGenesisHash: string
  offset: number | null
  limit: number | null
}

const signetSquidExtrinsicsQuery = gql`
  query ConfirmedTransactions($vaultPublicKey: String!, $chainGenesisHash: String!, $limit: Int, $offset: Int) {
    accountExtrinsics(
      where: {
        account: { address_eq: $vaultPublicKey }
        extrinsic: { block: { chainGenesisHash_eq: $chainGenesisHash } }
      }
      orderBy: extrinsic_id_ASC
      limit: $limit
      offset: $offset
    ) {
      extrinsic {
        id
        index
        callName
        callArgs
        signer
        block {
          hash
          timestamp
          height
        }
      }
    }
  }
`

const fetchRaw = async (vaultAddress: string, chainGenesisHash: string, _offset?: number | null) => {
  const extrinsics: ParsedTransaction[] = []

  const LIMIT = 100
  const variables: Variables = {
    vaultPublicKey: vaultAddress,
    chainGenesisHash,
    offset: null,
    limit: LIMIT,
  }

  let hasNextPage = true
  let offset = _offset
  while (hasNextPage) {
    if (offset) variables.offset = offset

    const res = (await fetchGraphQL(signetSquidExtrinsicsQuery, variables, 'tx-history')) as RawResponse

    res.data.accountExtrinsics.forEach(ext => {
      const signerObj = JSON.parse(ext.extrinsic.signer)
      extrinsics.push({
        block: {
          hash: ext.extrinsic.block.hash,
          height: parseInt(ext.extrinsic.block.height),
          timestamp: parseInt(ext.extrinsic.block.timestamp),
        },
        indexInBlock: ext.extrinsic.index,
        call: {
          args: ext.extrinsic.callArgs,
          name: ext.extrinsic.callName,
        },
        signer: signerObj.value as string,
      })
    })

    offset = res.data.accountExtrinsics.length
    hasNextPage = res.data.accountExtrinsics.length === LIMIT
  }

  return { data: { extrinsics } }
}

export const blockCacheState = atom<Record<string, Vec<GenericExtrinsic<AnyTuple>>>>({
  key: 'blockCacheState',
  default: {},
  dangerouslyAllowMutability: true,
})

export const useConfirmedTransactions = (): { loading: boolean; transactions: Transaction[] } => {
  const [loading, setLoading] = useState(true)
  const [selectedMultisig] = useSelectedMultisig()
  const [target, setTarget] = useState(selectedMultisig)
  const { api } = useApi(selectedMultisig.chain.genesisHash)
  const [confirmedTransactions, setConfirmedTransactions] = useRecoilState(rawConfirmedTransactionsState)
  const [unknownTxs, setUnknownTxs] = useRecoilState(unknownConfirmedTransactionsState)
  const txMetadataByTeamId = useRecoilValue(txMetadataByTeamIdState)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const nextFetchRef = useRef(new Date())
  const [blockCache, setBlockCache] = useRecoilState(blockCacheState)
  const allActiveChainTokens = useRecoilValueLoadable(allChainTokensSelector)

  // fetch if we have new unknown tx
  useEffect(() => {
    if (unknownTxs.length > 0) nextFetchRef.current = new Date()
  }, [unknownTxs.length])

  // setup auto refresh to execute when next fetch is due
  useEffect(() => {
    let interval = setInterval(() => {
      if (new Date().getTime() > nextFetchRef.current.getTime()) setAutoRefresh(true)
    }, 1_000)
    return () => {
      clearInterval(interval)
    }
  }, [])

  const getBlocks = useCallback(
    async (hashes: string[]) => {
      if (!api) return []

      try {
        const newBlocks = await Promise.all(
          hashes.filter(hash => !blockCache[hash]).map(hash => api.rpc.chain.getBlock(hash))
        )

        const newBlocksMap = newBlocks.reduce((acc, block) => {
          acc[block.block.header.hash.toString()] = block.block.extrinsics
          return acc
        }, {} as Record<string, Vec<GenericExtrinsic<AnyTuple>>>)

        setBlockCache(old => ({ ...old, ...newBlocksMap }))
      } catch (e) {
        console.error(e)
      }
    },
    [api, blockCache, setBlockCache]
  )

  const processedTransactions = useMemo(() => {
    try {
      if (allActiveChainTokens.state !== 'hasValue') return { decodedTransactions: [] }
      const txs = confirmedTransactions[selectedMultisig.id]?.transactions ?? []
      const decodedTransactions: Transaction[] = []
      const curChainTokens = allActiveChainTokens.contents.get(selectedMultisig.chain.squidIds.chainData)

      txs.forEach(tx => {
        try {
          const extrinsics = blockCache[tx.block.hash]
          if (!extrinsics || !api || !curChainTokens) return
          if (tx.call.name === 'Multisig.as_multi') {
            const multisigArgs = tx.call.args as {
              call: {
                /** pallet name */
                __kind: string
                value: any
              }
              maybeTimepoint?: { height: number; index: number }
              otherSignatories: string[]
              threshold: number
            }

            if (!multisigArgs.maybeTimepoint) return

            const signer = Address.fromPubKey(tx.signer)
            // impossible unless squid is broken
            if (!signer) return console.error(`Invalid signer from subsquid at ${tx.block.height}-${tx.indexInBlock}`)
            const otherSigners: Address[] = []
            for (const otherSigner of multisigArgs.otherSignatories) {
              const address = Address.fromPubKey(otherSigner)
              if (!address) throw Error('squid returned invalid pubkey!')
              otherSigners.push(address)
            }

            // TODO: get team's change log. Then check if there's any point in time where this multisig was the controller of the proxied account
            // const multisigAddress = toMultisigAddress([signer, ...otherSigners], multisigArgs.threshold)

            // transaction made from multisig + proxy vault via Multisig.asMulti -> Proxy.proxy call
            if (multisigArgs.call.__kind === 'Proxy' && multisigArgs.call.value?.__kind === 'proxy') {
              const innerProxyCall = multisigArgs.call.value as {
                /** pub key of proxied address */
                real: { value: string }
                call: {
                  /** pallet name */
                  __kind: string
                  value: {
                    /** call method */
                    __kind: string
                  }
                }
              }

              // make sure this tx is for us
              const realAddress = Address.fromPubKey(innerProxyCall.real.value)
              if (!realAddress)
                return console.error(`Invalid realAddress from subsquid at ${tx.block.height}-${tx.indexInBlock}`)
              if (!realAddress.isEqual(selectedMultisig.proxyAddress)) return // not ours

              const id = makeTransactionID(
                selectedMultisig.chain,
                multisigArgs.maybeTimepoint.height,
                multisigArgs.maybeTimepoint.index
              )

              // get tx metadata from backend
              const txMetadata = txMetadataByTeamId[selectedMultisig.id]?.data[id]

              // get the extrinsic from block to decode
              const ext = extrinsics[tx.indexInBlock]
              if (!ext) return
              const innerExt = ext.method.args[3]! // proxy ext is 3rd arg
              const callData = innerExt.toHex()

              // decode call data
              const decodedExt = decodeCallData(api, callData as string)
              const defaultName = `${innerProxyCall.call.__kind}.${innerProxyCall.call.value.__kind}`
              const decoded = extrinsicToDecoded(selectedMultisig, decodedExt, curChainTokens, txMetadata, defaultName)
              if (decoded === 'not_ours') return

              // insert tx to top of list
              decodedTransactions.unshift({
                hash: tx.block.hash as `0x${string}`,
                approvals: {},
                executedAt: {
                  block: tx.block.height,
                  index: tx.indexInBlock,
                  by: signer,
                },
                multisig: selectedMultisig,
                date: new Date(tx.block.timestamp),
                callData,
                id,
                ...decoded,
              })
              // txs is sorted by timestamp asc, we need to push to top of decodedTransactions to make it desc
            }
          }
        } catch (e) {}
      })

      return { decodedTransactions }
    } catch (e) {
      console.error(e)
      return { decodedTransactions: [] }
    }
  }, [
    allActiveChainTokens.contents,
    allActiveChainTokens.state,
    api,
    blockCache,
    confirmedTransactions,
    selectedMultisig,
    txMetadataByTeamId,
  ])

  const load = useCallback(async () => {
    // make sure we dont spam squid
    if (target.id === DUMMY_MULTISIG_ID || new Date().getTime() < nextFetchRef.current.getTime() || !api) return

    // cache the target in case it gets changed while we're fetching
    const fetchingFor = target
    setLoading(true)

    // refresh every 15 seconds by default. If a new tx is confirmed, refresh in 3 seconds
    nextFetchRef.current = new Date(Date.now() + (unknownTxs.length > 0 ? 3_000 : 15_000))

    try {
      const lastFetchedData = confirmedTransactions[fetchingFor.id]

      // get all raw transactions from last cursor
      const {
        data: { extrinsics },
      } = await fetchRaw(
        fetchingFor.proxyAddress.toPubKey(),
        fetchingFor.chain.genesisHash,
        lastFetchedData?.transactions.length
      )

      if (extrinsics.length > 0) {
        setConfirmedTransactions(old => ({
          ...old,
          [fetchingFor.id]: {
            transactions: [...(lastFetchedData?.transactions ?? []), ...extrinsics],
          },
        }))
      }

      // get the blocks and store in cache for use later
      await getBlocks(extrinsics.map(ext => ext.block.hash))

      setUnknownTxs(prev =>
        prev.filter(
          id =>
            extrinsics.find(ext => makeTransactionID(fetchingFor.chain, ext.block.height, ext.indexInBlock) === id) ===
            undefined
        )
      )
    } catch (e) {
      console.error('Failed to fetch squid', e)
    } finally {
      setLoading(false)
      setAutoRefresh(false)

      // no immediate refresh needed while we were fetching, and we have the latest result
      // so push next fetch time back
      if (new Date().getTime() < nextFetchRef.current.getTime())
        nextFetchRef.current = new Date(Date.now() + (unknownTxs.length > 0 ? 3_000 : 15_000))
    }
  }, [api, confirmedTransactions, getBlocks, setConfirmedTransactions, setUnknownTxs, target, unknownTxs.length])

  /**
   * Triggered when:
   * 1. selectedMultisig changes
   * 2. autoRefresh is true (when nextFetch is due, 15 seconds by default, 2 seconds when we are expecting new txs)
   * 3. hasUnknown is true (instant refresh when new tx is made)
   */
  useEffect(() => {
    load()
  }, [load, autoRefresh])

  // this will make sure changing vault only triggers 1 reload
  useEffect(() => {
    if (target.id === selectedMultisig.id) return
    setTarget(selectedMultisig)
    nextFetchRef.current = new Date()
  }, [selectedMultisig, target.id])

  return { loading: loading || !api, transactions: processedTransactions.decodedTransactions }
}
