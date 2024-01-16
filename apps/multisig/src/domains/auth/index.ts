import { useCallback, useMemo, useState } from 'react'
import { atom, selector, useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil'
import { web3FromSource } from '@polkadot/extension-dapp'
import { SiwsMessage } from '@talismn/siws'
import { InjectedAccount, accountsState } from '../extension'
import persistAtom from '../persist'
import toast from 'react-hot-toast'
import { captureException } from '@sentry/react'
import { useSelectedMultisig } from '@domains/multisig'

const SIWS_ENDPOINT = process.env.REACT_APP_SIWS_ENDPOINT ?? ''

// keyed by ss58 address, value is the auth token
type AuthTokenBook = Record<string, string | { accessToken: string; id: string } | undefined>

export type SignedInAccount = {
  jwtToken: string
  injected: InjectedAccount
  id: string
}

// store selected address in local storage
// then derive the JWT and injected account
export const selectedAddressState = atom<string | null>({
  key: 'SelectedAddress',
  default: null,
  effects_UNSTABLE: [persistAtom],
})

export const authTokenBookState = atom<AuthTokenBook>({
  key: 'AuthTokenBook',
  default: {},
  effects_UNSTABLE: [persistAtom],
})

// an account can only be selected if:
// - user has explicitly selected the address
// - jwt is stored in auth book
// - account is connected from extension
export const selectedAccountState = selector<SignedInAccount | null>({
  key: 'SelectedAccount',
  get: ({ get }) => {
    const selectedAddress = get(selectedAddressState)
    const authTokenBook = get(authTokenBookState)
    const extensionAccounts = get(accountsState)

    // account not explicitly selected
    if (!selectedAddress) return null

    // account not signed in, hence cannot be selected
    const auth = authTokenBook[selectedAddress]
    if (auth === undefined) return null

    // account not connected from extension
    const injected = extensionAccounts.find(account => account.address.toSs58() === selectedAddress)
    if (!injected) return null

    // backward compatibility: auth token used to be a string
    if (typeof auth === 'string') return null
    return { jwtToken: auth.accessToken, injected, id: auth.id }
  },
})

export const signedInAccountState = atom<string | null>({
  key: 'SignedInAccount',
  default: null,
})

export const useSignIn = () => {
  const [authTokenBook, setAuthTokenBook] = useRecoilState(authTokenBookState)
  const setSelectedAccount = useSetRecoilState(selectedAddressState)
  const [signingIn, setSigningIn] = useState(false)

  const signIn = useCallback(
    async (account: InjectedAccount) => {
      if (signingIn) return
      setSigningIn(true)

      const ss58Address = account.address.toSs58()
      let auth = authTokenBook[ss58Address]
      try {
        if (typeof auth === 'string' || !auth?.accessToken || !auth.id) {
          // to be able to retrieve the signer interface from this account
          // we can use web3FromSource which will return an InjectedExtension type
          const injector = await web3FromSource(account.meta.source)

          if (!injector.signer.signRaw) return toast.error('Wallet does not support signing message.')

          // generate nonce from server
          const res = await fetch(`${SIWS_ENDPOINT}/nonce`, {
            method: 'post',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          })
          const nonceData = await res.json()

          // error string captured by Hasura (e.g. invalid hasura query)
          if (nonceData.error) return toast.error(nonceData.error)

          const nonce = nonceData?.nonce

          // should've been captured by `nonceData.error`, but adding this check just to be sure
          if (!nonce) return toast.error('Failed to request for nonce.')

          // construct siws message
          const siws = new SiwsMessage({
            address: ss58Address,
            domain: 'signet.talisman.xyz',
            nonce,
            uri: window.location.origin,
            statement: 'Welcome to Signet! Please sign in to continue.',
            chainName: 'Substrate',
          })

          // sign payload for backend verification
          const signed = await siws.sign(injector)

          // exchange JWT token from server
          const verifyRes = await fetch(`${SIWS_ENDPOINT}/verify`, {
            method: 'post',
            body: JSON.stringify({ ...signed, address: ss58Address }),
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
          })

          const verifyData = await verifyRes.json()

          auth = {
            accessToken: verifyData?.accessToken,
            id: verifyData?.id,
          }
        }

        if (auth) {
          setSelectedAccount(ss58Address)
          setAuthTokenBook({
            ...authTokenBook,
            [ss58Address]: auth,
          })
        } else {
          toast.error('Failed to sign in.')
        }
      } catch (e) {
        console.error(e)
        captureException(e, { extra: { siwsEndpoint: SIWS_ENDPOINT } })
        toast.error(typeof e === 'string' ? e : (e as any).message ?? 'Failed to sign in.')
      } finally {
        setSigningIn(false)
      }
    },
    [authTokenBook, setAuthTokenBook, setSelectedAccount, signingIn]
  )

  return { signIn, signingIn }
}

export { AccountWatcher } from './AccountWatcher'

export const useUser = () => {
  const [multisig] = useSelectedMultisig()
  const user = useRecoilValue(selectedAccountState)
  const isCollaborator = useMemo(() => (user ? multisig.isCollaborator(user.injected.address) : true), [multisig, user])
  const isSigner = useMemo(() => (user ? multisig.isSigner(user.injected.address) : true), [multisig, user])
  return { user, isSigner, isCollaborator }
}