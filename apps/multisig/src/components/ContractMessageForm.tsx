import { useEffect, useMemo, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Button } from './ui/button'
import { ChevronDown } from '@talismn/icons'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from './ui/command'
import { AbiMessage } from '@polkadot/api-contract/types'
import { MessageSignature } from './SubstrateContractAbi/MessageSignature'
import { Chain } from '@domains/chains'
import { useApi } from '@domains/chains/pjs-api'
import { BN_ZERO, BN } from '@polkadot/util'
import { AbiParamsForm } from './SubstrateContractAbi/Params'
import { BalanceInput } from './BalanceInput'

type Props = {
  messages: AbiMessage[]
  onChange: (message: AbiMessage, args: any[], value: BN) => void
  chain: Chain
  label?: string
}

/** TODO: support payable */
export const ContractMessageForm: React.FC<Props> = ({ messages, onChange, chain, label = 'Message to send' }) => {
  const [messageIndex, setMessageIndex] = useState(0)
  const [openMethod, setOpenMethod] = useState(false)
  const { api } = useApi(chain.genesisHash)
  const [args, setArgs] = useState<{ value: any; valid: boolean }[]>([])
  const [value, setValue] = useState(BN_ZERO)

  const selectedMessage = useMemo(() => messages[messageIndex] ?? messages?.[0], [messageIndex, messages])

  useEffect(() => {
    if (!selectedMessage) return
    onChange(selectedMessage, args, value)
  }, [onChange, selectedMessage, args, value])

  if (!selectedMessage) return null

  return (
    <div className="w-full">
      {/** Message selector */}
      <div className="w-full">
        <p className="text-[14px] mb-[4px]">{label}</p>
        <Popover open={openMethod} onOpenChange={setOpenMethod}>
          <PopoverTrigger asChild>
            <Button className="w-full h-16 px-[20px]" variant="secondary">
              <div className="flex items-center justify-between w-full">
                <MessageSignature message={selectedMessage} chain={chain} withoutDocs />
                <ChevronDown />
              </div>
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            <Command>
              <CommandInput placeholder="Search methods..." />
              <CommandSeparator />
              <CommandList>
                <CommandEmpty>No methods found</CommandEmpty>
                <CommandGroup>
                  {messages.map((message, index) => (
                    <CommandItem
                      key={`${message.method}_${message.selector}`}
                      className="flex flex-col text-left items-start text-ellipsis overflow-hidden whitespace-nowrap w-full"
                      value={`${index}`}
                      onSelect={() => {
                        if (index !== messageIndex) {
                          setArgs([])
                          setMessageIndex(index)
                        }
                        setOpenMethod(false)
                      }}
                    >
                      <MessageSignature message={message} chain={chain} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {selectedMessage.isPayable && (
        <div className="mt-[16px] w-full">
          <BalanceInput label="Payable" chain={chain} onChange={setValue} />
        </div>
      )}

      {/** Render args form for selected message */}
      {api && selectedMessage.args.length > 0 && (
        <div className="w-full mt-[16px] pl-[24px]">
          <p className="text-[14px] mb-[4px]">Call parameters</p>
          <div className="p-[12px] border border-gray-700 rounded-[16px]">
            <AbiParamsForm
              chain={chain}
              params={selectedMessage.args}
              onChange={setArgs}
              registry={api.registry}
              value={args}
            />
          </div>
        </div>
      )}
    </div>
  )
}
