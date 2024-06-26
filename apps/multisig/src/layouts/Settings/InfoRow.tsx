import { Info } from '@talismn/icons'
import { Tooltip } from '@talismn/ui'
import { cn } from '@util/tailwindcss'

type Props = {
  label: string
  tooltip?: React.ReactNode
  labelClassName?: string
}

export const SettingsInfoRow: React.FC<React.PropsWithChildren<Props>> = ({
  labelClassName,
  label,
  tooltip,
  children,
}) => (
  <div className="flex flex-col gap-[4px] w-full">
    <div className="flex items-center gap-[8px] text-gray-200">
      <p className={cn('text-[14px] mt-[2px] text-gray-200', labelClassName)}>{label}</p>
      {tooltip && (
        <Tooltip content={<p css={{ fontSize: 12 }}>{tooltip}</p>}>
          <Info size={16} />
        </Tooltip>
      )}
    </div>
    {children}
  </div>
)
