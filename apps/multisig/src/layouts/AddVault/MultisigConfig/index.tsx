import { AugmentedAccount } from '@domains/multisig'
import { Address } from '@util/addresses'
import { CancleOrNext } from '../common/CancelOrNext'
import AddMembers from './AddMembers'
import { Chain } from '@domains/chains'
import { ThresholdSettings } from './ThresholdSettings'

type Props = {
  chain: Chain
  header?: string
  members: AugmentedAccount[]
  threshold: number
  onMembersChange: React.Dispatch<React.SetStateAction<Address[]>>
  onThresholdChange: (threshold: number) => void
  onBack: () => void
  onNext: () => void
}

export const MultisigConfig: React.FC<Props> = ({
  chain,
  header,
  onBack,
  onMembersChange,
  onNext,
  onThresholdChange,
  threshold,
  members,
}) => {
  return (
    <div className="grid justify-center items-center gap-[48px] max-w-[540px] w-full">
      <div className="w-full">
        <h4 className="text-[14px] text-center font-bold mb-[4px]">{header}</h4>
        <h1>Multisig Configuration</h1>
      </div>
      <AddMembers setAddedAccounts={onMembersChange} augmentedAccounts={members} chain={chain} />
      <ThresholdSettings membersCount={members.length} onChange={onThresholdChange} threshold={threshold} />
      <CancleOrNext
        block
        cancel={{ onClick: onBack, children: 'Back' }}
        next={{
          disabled: members.length <= 1 || threshold <= 1 || threshold > members.length,
          onClick: onNext,
        }}
      />
    </div>
  )
}
