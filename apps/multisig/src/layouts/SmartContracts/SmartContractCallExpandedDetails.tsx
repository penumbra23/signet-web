import { Transaction } from '@domains/multisig'
import { useContractByAddress } from '@domains/substrate-contracts/useContractByAddress'
import { useMemo } from 'react'
import { hexToU8a, compactAddLength } from '@polkadot/util'
import { StatusMessage } from '@components/StatusMessage'
import { useApi } from '@domains/chains/pjs-api'
import { AccountDetails } from '@components/AddressInput/AccountDetails'
import { cn } from '@util/tailwindcss'
import { useKnownAddresses } from '@hooks/useKnownAddresses'
import { Address } from '@util/addresses'

const Row: React.FC<React.PropsWithChildren & { label: string; className?: string }> = ({
  label,
  children,
  className,
}) => (
  <div className="w-full">
    <p className="mb-[4px]">{label}</p>
    <div className={cn('w-full bg-gray-800 p-[16px] rounded-[8px]', className)}>{children}</div>
  </div>
)

const IS_ADDRESS: Record<string, boolean> = {
  AccountId: true,
  Address: true,
  LookupSource: true,
  MultiAddress: true,
}
export const SmartContractCallExpandedDetails: React.FC<{ t: Transaction }> = ({ t }) => {
  const { api } = useApi(t.multisig.chain.rpcs)
  const { contract, contractDetails, loading } = useContractByAddress(t.decoded?.contractCall?.address, api)
  const { contactByAddress } = useKnownAddresses(t.multisig.id, {
    includeContracts: true,
    includeSelectedMultisig: true,
  })

  const decodedContractCall = useMemo(() => {
    if (!contract || !t.decoded?.contractCall) return undefined
    try {
      return contract.abi.decodeMessage(compactAddLength(hexToU8a(t.decoded.contractCall.data)))
    } catch (e) {
      console.error('Failed to decode contract call:', e)
      return undefined
    }
  }, [contract, t.decoded])

  if ((!decodedContractCall && loading) || !api)
    return (
      <div className="w-full">
        <StatusMessage type="loading" message="Loading smart contract..." />
      </div>
    )

  if (!decodedContractCall || !contractDetails) {
    return (
      <div>
        <p>Could not decode contract call data</p>
      </div>
    )
  }

  return (
    <div className="w-full grid gap-[16px]">
      <Row label="Contract">
        <AccountDetails
          address={contractDetails.address}
          chain={t.multisig.chain}
          name={contractDetails.name}
          withAddressTooltip
        />
      </Row>
      <Row label="Message">
        <p>{decodedContractCall.message.method}</p>
      </Row>
      {decodedContractCall.args.map((val, index) => {
        const arg = decodedContractCall.message.args[index]
        if (!arg) return null // impossible

        if (IS_ADDRESS[arg.type.type]) {
          const address = Address.fromSs58(val.toString())
          if (address)
            return (
              <Row key={index} label={arg.name}>
                <AccountDetails
                  address={address}
                  name={contactByAddress?.[address.toSs58()]?.name}
                  withAddressTooltip
                />
              </Row>
            )
        }
        return (
          <Row key={index} label={arg.name}>
            <p className="break-all">{val.toString()}</p>
          </Row>
        )
      })}
    </div>
  )
}