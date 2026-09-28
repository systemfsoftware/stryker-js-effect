import * as Option from 'effect/Option'

export const portFields = (port: number | undefined): { readonly port?: number } =>
  Option.match(Option.fromUndefinedOr(port), { onNone: () => ({}), onSome: (present) => ({ port: present }) })

export const addressFields = (address: string | undefined): { readonly address?: string } =>
  Option.match(Option.fromUndefinedOr(address), { onNone: () => ({}), onSome: (present) => ({ address: present }) })

export const reasonFields = (reason: string | undefined): { readonly reason?: string } =>
  Option.match(Option.fromUndefinedOr(reason), { onNone: () => ({}), onSome: (present) => ({ reason: present }) })
